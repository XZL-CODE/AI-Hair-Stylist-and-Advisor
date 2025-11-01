import React, { useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Modality, Type } from '@google/genai';

// --- ICONS ---
const UploadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#555' }}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
    </svg>
);
const SparklesIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0l1.41 4.59L18 6l-4.59 1.41L12 12l-1.41-4.59L6 6l4.59-1.41L12 0zm0 12l-1.41 4.59L6 18l4.59 1.41L12 24l1.41-4.59L18 18l-4.59-1.41L12 12z"/></svg>
);

// --- TYPES ---
type Mode = 'advisor' | 'fusion';
interface HairstyleRecommendation {
    styleName: string;
    description: string;
    reason: string;
    imagePrompt: string;
    generatedImage?: string;
}

// --- UTILS ---
const toBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
});

// --- MAIN APP ---
const App: React.FC = () => {
    const [mode, setMode] = useState<Mode>('advisor');
    const [userImage, setUserImage] = useState<{ file: File, dataUrl: string } | null>(null);
    const [targetImage, setTargetImage] = useState<{ file: File, dataUrl: string } | null>(null);
    
    const [loading, setLoading] = useState<boolean>(false);
    const [loadingMessage, setLoadingMessage] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    
    const [advisorResults, setAdvisorResults] = useState<HairstyleRecommendation[]>([]);
    const [fusionResult, setFusionResult] = useState<string | null>(null);

    const handleImageUpload = async (file: File, type: 'user' | 'target') => {
        if (!file || !file.type.startsWith('image/')) {
            setError(`Please upload a valid image file for ${type === 'user' ? 'your photo' : 'the target style'}.`);
            return;
        }
        setError(null);
        const dataUrl = await toBase64(file);
        if (type === 'user') {
            setUserImage({ file, dataUrl });
            // Reset results when a new user photo is uploaded
            setAdvisorResults([]);
            setFusionResult(null);
        } else {
            setTargetImage({ file, dataUrl });
            setFusionResult(null);
        }
    };
    
    const handleGenerate = async () => {
        setLoading(true);
        setError(null);
        setAdvisorResults([]);
        setFusionResult(null);

        if (mode === 'advisor') {
            await handleAdvisorMode();
        } else {
            await handleFusionMode();
        }
        setLoading(false);
        setLoadingMessage('');
    };
    
    const handleAdvisorMode = async () => {
        if (!userImage) return;

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const userImageBase64 = userImage.dataUrl.split(',')[1];
            
            // Step 1: Analyze image and get hairstyle recommendations (text)
            setLoadingMessage('Analyzing your features...');
            const textModelResponse = await ai.models.generateContent({
                model: 'gemini-2.5-pro',
                contents: {
                    parts: [{
                        inlineData: { data: userImageBase64, mimeType: userImage.file.type }
                    }, {
                        text: `你是一位专业的AI发型顾问。请仔细分析照片中人物的脸型和五官特点，然后推荐3款适合的发型。
严格按照下面描述的JSON格式进行响应。
对于每款发型，请提供：
- \`styleName\`: 发型名称 (中文)。
- \`description\`: 一句话描述 (中文)。
- \`reason\`: 推荐理由 (中文)。
- \`imagePrompt\`: 一个给图片生成模型使用的**英文**提示词。这个提示词必须非常具体、富有创意，以避免生成通用或受版权保护的图像。它应该指导图片模型将建议的发型应用到照片中的人身上。提示词应包含发型名称，并要求自然地融合，匹配脸型和光线。**关键是要加入描述性的词语来增加独特性。** 例如："Create a photorealistic image applying a modern interpretation of the 'Classic Side Part' hairstyle to the man in the photo. The hair should have detailed texture and volume, blending naturally with his head shape under soft, natural lighting, looking stylish and unique."。
所有中文部分必须使用中文。`
                    }]
                },
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            recommendations: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        styleName: { type: Type.STRING },
                                        description: { type: Type.STRING },
                                        reason: { type: Type.STRING },
                                        imagePrompt: { type: Type.STRING }
                                    },
                                    required: ["styleName", "description", "reason", "imagePrompt"]
                                }
                            }
                        },
                        required: ["recommendations"]
                    },
                }
            });

            if (!textModelResponse || !textModelResponse.text) {
                const finishReason = textModelResponse?.candidates?.[0]?.finishReason;
                let errorMessage = "The AI failed to provide hairstyle suggestions.";
                if (finishReason && finishReason !== 'STOP') {
                    errorMessage = `Text generation failed: ${finishReason}. Please try a different photo.`;
                }
                throw new Error(errorMessage);
            }
            
            const recommendations: HairstyleRecommendation[] = JSON.parse(textModelResponse.text).recommendations;
            if (!recommendations || recommendations.length === 0) {
                throw new Error("The AI could not generate hairstyle recommendations. Please try another photo.");
            }
            setAdvisorResults(recommendations);

            // Step 2: Generate an image for each recommendation
            const imageGenerationPromises = recommendations.map(async (rec, index) => {
                try {
                    setLoadingMessage(`Generating style ${index + 1}/${recommendations.length}: ${rec.styleName}...`);
                    const imageResponse = await ai.models.generateContent({
                        model: 'gemini-2.5-flash-image',
                        contents: {
                            parts: [
                                { inlineData: { data: userImageBase64, mimeType: userImage.file.type } },
                                { text: rec.imagePrompt },
                            ]
                        },
                        config: { responseModalities: [Modality.IMAGE] }
                    });

                    const candidate = imageResponse.candidates?.[0];
                    const part = candidate?.content?.parts?.find(p => p.inlineData);
                    
                    if (part?.inlineData) {
                        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                    } else {
                        const reason = candidate?.finishReason;
                        console.error(`Image generation failed for "${rec.styleName}". Reason: ${reason || 'No image data returned'}. Full candidate:`, candidate);
                        return undefined;
                    }
                } catch (e) {
                    console.error(`Error during image generation for "${rec.styleName}":`, e);
                    return undefined;
                }
            });

            const generatedImages = await Promise.all(imageGenerationPromises);

            setAdvisorResults(recommendations.map((rec, i) => ({ ...rec, generatedImage: generatedImages[i] })));

        } catch (e) {
            setError(e instanceof Error ? `Advisor Mode Error: ${e.message}` : 'An unknown error occurred.');
            console.error(e);
        }
    };

    const handleFusionMode = async () => {
        if (!userImage || !targetImage) return;

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const userImageBase64 = userImage.dataUrl.split(',')[1];
            const targetImageBase64 = targetImage.dataUrl.split(',')[1];
            
            setLoadingMessage('Fusing hairstyles...');
            
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: {
                    parts: [
                        { inlineData: { data: userImageBase64, mimeType: userImage.file.type } },
                        { inlineData: { data: targetImageBase64, mimeType: targetImage.file.type } },
                        { text: "Apply the hairstyle from the second image (the target style) onto the person in the first image (the user's photo). Blend it seamlessly and realistically, matching the hair to the person's head shape, face, and skin tone." },
                    ]
                },
                config: { responseModalities: [Modality.IMAGE] }
            });

            const candidate = response.candidates?.[0];
            const part = candidate?.content?.parts?.find(p => p.inlineData);

            if (part?.inlineData) {
                setFusionResult(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
            } else {
                 if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
                     setError(`Image generation failed: ${candidate.finishReason}. Please try different images.`);
                } else {
                     setError("No image was generated. The model may not have been able to fulfill the request.");
                }
            }

        } catch (e) {
            setError(e instanceof Error ? `Fusion Mode Error: ${e.message}` : 'An unknown error occurred.');
            console.error(e);
        }
    };

    const isGenerateDisabled = loading || !userImage || (mode === 'fusion' && !targetImage);

    // --- RENDER ---
    return (
        <div style={styles.container}>
            <header style={styles.header}>
                <h1 style={styles.title}>AI Hair Stylist</h1>
                <p style={styles.subtitle}>Get personalized hairstyle recommendations or try on a style from a photo.</p>
            </header>
            
            <div style={styles.modeSelector}>
                <button onClick={() => setMode('advisor')} style={mode === 'advisor' ? styles.modeButtonActive : styles.modeButton}>AI Hair Advisor</button>
                <button onClick={() => setMode('fusion')} style={mode === 'fusion' ? styles.modeButtonActive : styles.modeButton}>AI Hairstyle Fusion</button>
            </div>
            
            {/* FIX: Add className to apply responsive styles via CSS class */}
            <main style={styles.mainGrid} className="main-grid">
                {/* Input Column */}
                <div style={styles.column}>
                    <h2 style={styles.columnTitle}>1. Upload Your Photo</h2>
                    <ImageUploader image={userImage?.dataUrl} onUpload={(file) => handleImageUpload(file, 'user')} />

                    {mode === 'fusion' && (
                        <>
                            <h2 style={{...styles.columnTitle, marginTop: '1rem'}}>2. Upload Target Hairstyle</h2>
                            <ImageUploader image={targetImage?.dataUrl} onUpload={(file) => handleImageUpload(file, 'target')} />
                        </>
                    )}

                    <button
                        onClick={handleGenerate}
                        disabled={isGenerateDisabled}
                        style={{ ...styles.button, ...(isGenerateDisabled ? styles.buttonDisabled : {}) }}
                    >
                        <SparklesIcon />
                        {loading ? (loadingMessage || 'Working...') : 'Generate Style'}
                    </button>
                </div>

                {/* Result Column */}
                <div style={styles.column}>
                    <h2 style={styles.columnTitle}>Result</h2>
                    <div style={styles.outputContainer}>
                        {loading && <div style={styles.loadingOverlay}><div className="skeleton-loader"></div><p>{loadingMessage}</p></div>}
                        {error && <div style={styles.error} role="alert">{error}</div>}
                        
                        {/* Advisor Results */}
                        {mode === 'advisor' && !loading && advisorResults.length > 0 && (
                            <div style={styles.advisorResultsContainer}>
                                {advisorResults.map((rec, i) => (
                                    <div key={i} style={styles.advisorCard}>
                                        {rec.generatedImage ? <img src={rec.generatedImage} alt={`Generated: ${rec.styleName}`} style={styles.resultImage}/> : <div style={styles.resultImagePlaceholder}>Image Failed</div>}
                                        <div style={styles.advisorCardContent}>
                                            <h3 style={styles.advisorCardTitle}>{rec.styleName}</h3>
                                            <p style={styles.advisorCardText}><strong>推荐理由:</strong> {rec.reason}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        
                        {/* Fusion Result */}
                        {mode === 'fusion' && !loading && fusionResult && (
                            <img src={fusionResult} alt="Fused hairstyle result" style={styles.resultImage} />
                        )}
                        
                        {!loading && !error && advisorResults.length === 0 && !fusionResult && (
                             <p style={styles.placeholderText}>The magic will appear here...</p>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
};

// --- SUB-COMPONENTS ---
const ImageUploader: React.FC<{image: string | null; onUpload: (file: File) => void;}> = ({ image, onUpload }) => {
    const [isDragging, setIsDragging] = useState(false);
    const inputId = `fileInput-${Math.random()}`;

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault(); e.stopPropagation(); setIsDragging(false);
        if (e.dataTransfer.files?.[0]) onUpload(e.dataTransfer.files[0]);
    }, [onUpload]);
    const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }, []);
    const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }, []);
    const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files?.[0]) onUpload(e.target.files[0]); };

    return (
        <div 
            style={{...styles.dropzone, ...(isDragging ? styles.dropzoneActive : {})}}
            onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
            onClick={() => document.getElementById(inputId)?.click()}
        >
            <input type="file" id={inputId} accept="image/*" onChange={onFileChange} style={{ display: 'none' }}/>
            {image ? (
                <img src={image} alt="Uploaded preview" style={styles.previewImage} />
            ) : (
                <div style={styles.dropzoneContent}><UploadIcon /><p style={styles.dropzoneText}>Drag & drop or click to browse</p></div>
            )}
        </div>
    );
};


// --- STYLES ---
// FIX: Add media query for responsive grid layout. Inline styles in React do not support media queries.
const dynamicStyles = `
    @keyframes pulse { 0%, 100% { background-color: rgba(255, 255, 255, 0.05); } 50% { background-color: rgba(255, 255, 255, 0.1); } }
    .skeleton-loader { width: 100%; height: 100%; animation: pulse 1.5s ease-in-out infinite; border-radius: 12px; }
    @media (max-width: 900px) {
      .main-grid {
        grid-template-columns: 1fr;
      }
    }
`;
document.head.appendChild(document.createElement("style")).textContent = dynamicStyles;

const styles: { [key: string]: React.CSSProperties } = {
    container: { display: 'flex', flexDirection: 'column', gap: '1.5rem' },
    header: { textAlign: 'center' },
    title: { margin: 0, fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 700, background: 'linear-gradient(90deg, #8E2DE2, #4A00E0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' },
    subtitle: { margin: '0.5rem auto 0', fontSize: 'clamp(0.9rem, 2vw, 1.1rem)', color: '#a0a0a0', maxWidth: '600px', lineHeight: 1.5 },
    modeSelector: { display: 'flex', justifyContent: 'center', gap: '1rem', backgroundColor: '#1E1E1E', padding: '0.5rem', borderRadius: '12px', alignSelf: 'center' },
    modeButton: { background: 'none', border: 'none', color: '#a0a0a0', padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontSize: '1rem', fontWeight: 500, transition: 'background-color 0.2s, color 0.2s' },
    modeButtonActive: { background: 'linear-gradient(90deg, #8E2DE2, #4A00E0)', color: '#fff', padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontSize: '1rem', fontWeight: 500, transition: 'background-color 0.2s, color 0.2s' },
    // FIX: Removed invalid '@media' query from inline style object. This is now handled by a CSS class.
    mainGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' },
    column: { display: 'flex', flexDirection: 'column', gap: '1rem', backgroundColor: '#1E1E1E', padding: 'clamp(1rem, 5vw, 2rem)', borderRadius: '16px', border: '1px solid #2D2D2D' },
    columnTitle: { marginTop: 0, color: '#E0E0E0', fontSize: '1.25rem', fontWeight: 500 },
    dropzone: { border: '2px dashed #444', borderRadius: '12px', padding: '1rem', textAlign: 'center', cursor: 'pointer', backgroundColor: '#121212', minHeight: '200px', display: 'flex', justifyContent: 'center', alignItems: 'center', transition: 'border-color 0.3s, background-color 0.3s', overflow: 'hidden', position: 'relative' },
    dropzoneActive: { borderColor: '#8E2DE2', backgroundColor: 'rgba(142, 45, 226, 0.1)' },
    dropzoneContent: { display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', justifyContent: 'center' },
    dropzoneText: { color: '#999', margin: 0 },
    previewImage: { maxWidth: '100%', maxHeight: '300px', borderRadius: '8px', objectFit: 'contain' },
    button: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.8rem 1.5rem', fontSize: '1rem', fontWeight: 500, color: '#fff', background: 'linear-gradient(90deg, #8E2DE2, #4A00E0)', border: 'none', borderRadius: '8px', cursor: 'pointer', transition: 'transform 0.2s ease, box-shadow 0.2s ease', marginTop: 'auto' },
    buttonDisabled: { background: '#444', color: '#888', cursor: 'not-allowed' },
    outputContainer: { border: '1px solid #2D2D2D', borderRadius: '12px', minHeight: '250px', flexGrow: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1rem', backgroundColor: '#121212', position: 'relative', overflow: 'auto' },
    loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(18, 18, 18, 0.8)', zIndex: 10, gap: '1rem' },
    placeholderText: { color: '#888', textAlign: 'center', fontSize: '1.1rem' },
    error: { color: '#ffcdd2', backgroundColor: 'rgba(239, 83, 80, 0.2)', border: '1px solid #ef5350', padding: '1rem', borderRadius: '8px', width: 'calc(100% - 2rem)', textAlign: 'center', wordBreak: 'break-word' },
    advisorResultsContainer: { display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%' },
    advisorCard: { backgroundColor: '#2D2D2D', borderRadius: '12px', overflow: 'hidden' },
    advisorCardContent: { padding: '1rem' },
    advisorCardTitle: { margin: '0 0 0.5rem 0', color: '#fff', fontSize: '1.1rem' },
    advisorCardText: { margin: 0, color: '#b0b0b0', fontSize: '0.9rem', lineHeight: 1.5 },
    resultImage: { width: '100%', height: 'auto', display: 'block', objectFit: 'cover' },
    resultImagePlaceholder: { width: '100%', height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#121212', color: '#888' }
};

// --- RENDER APP ---
const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);