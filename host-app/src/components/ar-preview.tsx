'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { FilesetResolver, ImageSegmenter, FaceLandmarker } from '@mediapipe/tasks-vision';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { _mpDebugLogged?: boolean; }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface AREffect {
  id: string;
  name: string;
  type:
    | 'background' | 'filter' | 'blur' | 'preset-bg'
    | 'silhouette' | 'silhouette-bg'
    | 'none'
    // Face effects (use FaceLandmarker)
    | 'face-blur'      // blur just the face region
    | 'beauty'         // subtle skin-smoothing over the face
    | 'face-mask-cat'  // cat ears + nose + whiskers
    | 'face-mask-star' // star eyes + sparkles;
  icon: string;
  presetImage?: string;
  category?: 'backgrounds' | 'filters' | 'beauty' | 'face' | 'none';
}

export interface SegmentationSettings {
  threshold: number;
  edgeSmoothing: number;
  alphaThreshold: number;
}

interface MediaPipeARProps {
  enabled?: boolean;
  /** Background-class effect (blur / silhouette / preset image). Applied first. */
  backgroundEffect?: AREffect | null;
  /** Face-class effect (face-blur / beauty / cat / star). Composited on top. */
  faceEffect?: AREffect | null;
  customBackgroundUrl?: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onReady?: () => void;
  onStreamReady?: (stream: MediaStream) => void;
  videoDeviceId?: string;
  segmentationSettings?: SegmentationSettings;
}

export default function MediaPipeAR({
  enabled = false,
  backgroundEffect = null,
  faceEffect = null,
  customBackgroundUrl,
  containerRef,
  onReady,
  onStreamReady,
  videoDeviceId,
  segmentationSettings = { threshold: 127, edgeSmoothing: 3, alphaThreshold: 0.1 },
}: MediaPipeARProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const imageSegmenterRef = useRef<ImageSegmenter | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const segmentationSettingsRef = useRef<SegmentationSettings>(segmentationSettings);

  const initializeMediaPipe = useCallback(async () => {
    if (isInitialized || !containerRef.current || typeof window === 'undefined') return;
    setIsLoading(true); setError(null);
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );
      const segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO', outputCategoryMask: true, outputConfidenceMasks: true,
      });
      imageSegmenterRef.current = segmenter;
      const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO', numFaces: 1,
      });
      faceLandmarkerRef.current = landmarker;
      const video = document.createElement('video');
      video.autoplay = true; video.playsInline = true; video.muted = true;
      videoRef.current = video;
      const constraints: MediaStreamConstraints = { video: videoDeviceId ? { deviceId: videoDeviceId } : true, audio: false };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream; await video.play();
      const canvas = document.createElement('canvas');
      canvas.width = 1280; canvas.height = 720;
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:10;';
      canvasRef.current = canvas;
      containerRef.current.appendChild(canvas);
      const outputStream = canvas.captureStream(30);
      streamRef.current = outputStream;
      setIsInitialized(true); setIsLoading(false);
      onReady?.();
      setTimeout(() => { if (streamRef.current) onStreamReady?.(streamRef.current); }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize AR');
      setIsLoading(false);
    }
  }, [containerRef, onReady, onStreamReady, videoDeviceId, isInitialized]);

  useEffect(() => { segmentationSettingsRef.current = segmentationSettings; }, [segmentationSettings]);

  // Init / cleanup on enable toggle
  useEffect(() => {
    if (enabled && !isInitialized && !isLoading) { initializeMediaPipe(); }
    else if (!enabled && isInitialized) {
      if (animationFrameRef.current) { cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null; }
      if (videoRef.current?.srcObject) { (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop()); videoRef.current.srcObject = null; }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      if (canvasRef.current?.parentNode) { canvasRef.current.parentNode.removeChild(canvasRef.current); canvasRef.current = null; }
      if (imageSegmenterRef.current) { imageSegmenterRef.current.close(); imageSegmenterRef.current = null; }
      if (faceLandmarkerRef.current) { faceLandmarkerRef.current.close(); faceLandmarkerRef.current = null; }
      setIsInitialized(false);
    }
  }, [enabled, isInitialized, isLoading, initializeMediaPipe]);

  // Load background image
  useEffect(() => {
    if (!backgroundEffect || !isInitialized) return;
    let imageUrl: string | null = null;
    if (backgroundEffect.type === 'background' && customBackgroundUrl) imageUrl = customBackgroundUrl;
    else if (backgroundEffect.type === 'preset-bg' && backgroundEffect.presetImage) imageUrl = backgroundEffect.presetImage;
    if (imageUrl) {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { backgroundImageRef.current = img; };
      img.src = imageUrl;
    } else { backgroundImageRef.current = null; }
  }, [backgroundEffect, customBackgroundUrl, isInitialized]);

  // Rendering loop
  useEffect(() => {
    if (!enabled || !isInitialized) {
      if (animationFrameRef.current) { cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null; }
      return;
    }
    const video = videoRef.current; const canvas = canvasRef.current; const segmenter = imageSegmenterRef.current;
    if (!video || !canvas || !segmenter) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    let lastVideoTime = -1;

    const smoothMask = (maskData: Uint8Array, maskWidth: number, maskHeight: number, kernelSize: number) => {
      if (kernelSize <= 1) return maskData;
      const half = Math.floor(kernelSize / 2);
      const out = new Uint8Array(maskData.length);
      for (let i = 0; i < maskData.length; i++) {
        const x = i % maskWidth; const y = Math.floor(i / maskWidth);
        let sum = 0; let cnt = 0;
        for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
          const nx = x + dx; const ny = y + dy;
          if (nx >= 0 && nx < maskWidth && ny >= 0 && ny < maskHeight) { sum += maskData[ny * maskWidth + nx]; cnt++; }
        }
        out[i] = Math.round(sum / cnt);
      }
      return out;
    };

    const blendBg = (pixels: Uint8ClampedArray, bgPixels: Uint8ClampedArray, mask: Uint8Array, mW: number, mH: number, cW: number, cH: number, invert: boolean) => {
      const s = segmentationSettingsRef.current;
      for (let y = 0; y < cH; y++) for (let x = 0; x < cW; x++) {
        const mX = Math.floor((x / cW) * mW); const mY = Math.floor((y / cH) * mH);
        const mi = mY * mW + mX; const ci = (y * cW + x) * 4;
        if (mi < 0 || mi >= mask.length || ci < 0 || ci >= pixels.length - 3) continue;
        const v = mask[mi];
        const isBg = v > s.threshold;
        if (invert ? !isBg : isBg) {
          const raw = invert ? (1.0 - v / s.threshold) : (v - s.threshold) / (255 - s.threshold);
          const alpha = Math.max(0, Math.min(1, raw));
          if (alpha > s.alphaThreshold) {
            pixels[ci]   = Math.round(pixels[ci]   * (1 - alpha) + bgPixels[ci]   * alpha);
            pixels[ci+1] = Math.round(pixels[ci+1] * (1 - alpha) + bgPixels[ci+1] * alpha);
            pixels[ci+2] = Math.round(pixels[ci+2] * (1 - alpha) + bgPixels[ci+2] * alpha);
          }
        }
      }
    };

    const renderFrame = async () => {
      if (!enabled || !video || !canvas) return;
      const t = video.currentTime;
      if (t === lastVideoTime) { animationFrameRef.current = requestAnimationFrame(renderFrame); return; }
      lastVideoTime = t;
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth || 1280; canvas.height = video.videoHeight || 720;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      // Routes by effect.type, so a background-class effect only runs the
      // segmentation branches and a face-class effect only the landmark
      // branch. Calling it for each slot composites both in a single frame.
      const applyEffect = (effect: AREffect | null) => {
        if (!effect || effect.type === 'none') { /* passthrough */ }
        else if (effect.type === 'blur' || effect.type === 'background' || effect.type === 'preset-bg') {
          const res = segmenter.segmentForVideo(video, performance.now());
          if (res?.categoryMask) {
            const cm = res.categoryMask;
            const mData = cm.getAsUint8Array(); const mW = cm.width; const mH = cm.height;
            const s = segmentationSettingsRef.current;
            const smooth = smoothMask(mData, mW, mH, s.edgeSmoothing);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const bgCanvas = document.createElement('canvas');
            bgCanvas.width = canvas.width; bgCanvas.height = canvas.height;
            const bgCtx = bgCanvas.getContext('2d')!;
            if (effect.type === 'blur') { bgCtx.filter = 'blur(20px)'; bgCtx.drawImage(video, 0, 0, canvas.width, canvas.height); }
            else if (backgroundImageRef.current) { bgCtx.drawImage(backgroundImageRef.current, 0, 0, canvas.width, canvas.height); }
            else { bgCtx.filter = 'blur(20px)'; bgCtx.drawImage(video, 0, 0, canvas.width, canvas.height); }
            const bgData = bgCtx.getImageData(0, 0, canvas.width, canvas.height);
            blendBg(imgData.data, bgData.data, smooth, mW, mH, canvas.width, canvas.height, false);
            ctx.putImageData(imgData, 0, 0);
          }
        } else if (effect.type === 'silhouette') {
          const res = segmenter.segmentForVideo(video, performance.now());
          if (res?.categoryMask) {
            const cm = res.categoryMask;
            const mData = cm.getAsUint8Array(); const mW = cm.width; const mH = cm.height;
            const s = segmentationSettingsRef.current;
            const smooth = smoothMask(mData, mW, mH, s.edgeSmoothing);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const black = new Uint8ClampedArray(imgData.data.length); // all zeros = black
            blendBg(imgData.data, black, smooth, mW, mH, canvas.width, canvas.height, true);
            ctx.putImageData(imgData, 0, 0);
          }
        } else if (
          effect.type === 'face-blur' ||
          effect.type === 'beauty' ||
          effect.type === 'face-mask-cat' ||
          effect.type === 'face-mask-star'
        ) {
          const fl = faceLandmarkerRef.current;
          if (fl) {
            const faceRes = fl.detectForVideo(video, performance.now());
            if (faceRes.faceLandmarks.length > 0) {
              const lms = faceRes.faceLandmarks[0];
              const cW = canvas.width; const cH = canvas.height;

              // Compute face bounding box (normalized → pixel)
              let minX = 1, minY = 1, maxX = 0, maxY = 0;
              for (const lm of lms) {
                if (lm.x < minX) minX = lm.x; if (lm.x > maxX) maxX = lm.x;
                if (lm.y < minY) minY = lm.y; if (lm.y > maxY) maxY = lm.y;
              }
              const cx = ((minX + maxX) / 2) * cW;
              const cy = ((minY + maxY) / 2) * cH;
              const rx = ((maxX - minX) / 2) * cW * 1.15;
              const ry = ((maxY - minY) / 2) * cH * 1.15;
              const faceW = (maxX - minX) * cW;

              if (effect.type === 'face-blur') {
                // Clip to face ellipse, draw blurred
                ctx.save();
                ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.clip();
                ctx.filter = 'blur(18px)';
                ctx.drawImage(video, 0, 0, cW, cH);
                ctx.filter = 'none';
                ctx.restore();

              } else if (effect.type === 'beauty') {
                // Clip to face ellipse, light-blur blend for skin smoothing
                ctx.save();
                ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.clip();
                ctx.globalAlpha = 0.55;
                ctx.filter = 'blur(4px)';
                ctx.drawImage(video, 0, 0, cW, cH);
                ctx.filter = 'none'; ctx.globalAlpha = 1;
                ctx.restore();

              } else if (effect.type === 'face-mask-cat') {
                // Key landmarks
                const earL = lms[127] ?? lms[234];  // left side of head
                const earR = lms[356] ?? lms[454];  // right side of head
                const nose = lms[4];                 // nose tip
                const leftEye = lms[468] ?? lms[33];
                const rightEye = lms[473] ?? lms[263];
                const earSize = faceW * 0.22;

                // Left ear (pink triangle)
                ctx.save();
                ctx.fillStyle = '#ff69b4';
                ctx.beginPath();
                ctx.moveTo(earL.x * cW - earSize * 0.6, earL.y * cH - earSize * 1.6);
                ctx.lineTo(earL.x * cW + earSize * 0.2, earL.y * cH - earSize * 0.1);
                ctx.lineTo(earL.x * cW - earSize * 0.8, earL.y * cH + earSize * 0.1);
                ctx.closePath(); ctx.fill();
                // inner highlight
                ctx.fillStyle = '#ffb6c1';
                ctx.beginPath();
                ctx.moveTo(earL.x * cW - earSize * 0.5, earL.y * cH - earSize * 1.2);
                ctx.lineTo(earL.x * cW + earSize * 0.05, earL.y * cH - earSize * 0.2);
                ctx.lineTo(earL.x * cW - earSize * 0.55, earL.y * cH);
                ctx.closePath(); ctx.fill();

                // Right ear (pink triangle)
                ctx.fillStyle = '#ff69b4';
                ctx.beginPath();
                ctx.moveTo(earR.x * cW + earSize * 0.6, earR.y * cH - earSize * 1.6);
                ctx.lineTo(earR.x * cW - earSize * 0.2, earR.y * cH - earSize * 0.1);
                ctx.lineTo(earR.x * cW + earSize * 0.8, earR.y * cH + earSize * 0.1);
                ctx.closePath(); ctx.fill();
                ctx.fillStyle = '#ffb6c1';
                ctx.beginPath();
                ctx.moveTo(earR.x * cW + earSize * 0.5, earR.y * cH - earSize * 1.2);
                ctx.lineTo(earR.x * cW - earSize * 0.05, earR.y * cH - earSize * 0.2);
                ctx.lineTo(earR.x * cW + earSize * 0.55, earR.y * cH);
                ctx.closePath(); ctx.fill();
                ctx.restore();

                // Cat nose (small pink triangle at nose tip)
                const nX = nose.x * cW; const nY = nose.y * cH;
                const ns = faceW * 0.04;
                ctx.fillStyle = '#ff69b4';
                ctx.beginPath();
                ctx.moveTo(nX, nY - ns); ctx.lineTo(nX - ns, nY + ns * 0.6); ctx.lineTo(nX + ns, nY + ns * 0.6);
                ctx.closePath(); ctx.fill();

                // Whiskers
                const wLen = faceW * 0.28;
                ctx.save();
                ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
                for (let i = -1; i <= 1; i++) {
                  const oy = i * (faceW * 0.035);
                  ctx.beginPath(); ctx.moveTo(nX - 6, nY + oy); ctx.lineTo(nX - 6 - wLen, nY + oy - i * 4); ctx.stroke();
                  ctx.beginPath(); ctx.moveTo(nX + 6, nY + oy); ctx.lineTo(nX + 6 + wLen, nY + oy - i * 4); ctx.stroke();
                }
                ctx.restore();

                // Eye shine dots
                const eyeSize = faceW * 0.03;
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.beginPath(); ctx.arc(leftEye.x * cW, leftEye.y * cH, eyeSize, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(rightEye.x * cW, rightEye.y * cH, eyeSize, 0, Math.PI * 2); ctx.fill();

              } else if (effect.type === 'face-mask-star') {
                const leftEye  = lms[468] ?? lms[33];
                const rightEye = lms[473] ?? lms[263];
                const emoji = Math.floor(faceW * 0.22) + 'px serif';
                const small  = Math.floor(faceW * 0.12) + 'px serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

                // Star over each eye
                ctx.font = emoji;
                ctx.fillText('⭐', leftEye.x * cW, leftEye.y * cH);
                ctx.fillText('⭐', rightEye.x * cW, rightEye.y * cH);

                // Sparkles around face perimeter
                ctx.font = small;
                ctx.fillText('✨', minX * cW - faceW * 0.15, cy);
                ctx.fillText('✨', maxX * cW + faceW * 0.15, cy);
                ctx.fillText('✨', cx, minY * cH - faceW * 0.15);
                ctx.fillText('✨', cx - faceW * 0.25, (minY + 0.1) * cH);
                ctx.fillText('✨', cx + faceW * 0.25, (minY + 0.1) * cH);
              }
            }
          }
        }
      };
      try {
        applyEffect(backgroundEffect); // composite background first
        applyEffect(faceEffect);       // then draw face overlay on top
      } catch { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); }
      animationFrameRef.current = requestAnimationFrame(renderFrame);
    };
    renderFrame();
    return () => { if (animationFrameRef.current) { cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null; } };
  }, [enabled, isInitialized, backgroundEffect, faceEffect]);

  // Show/hide canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (enabled && isInitialized && canvas) {
      if (containerRef.current && !containerRef.current.contains(canvas)) containerRef.current.appendChild(canvas);
    } else if (!enabled && canvas?.parentNode) { canvas.parentNode.removeChild(canvas); }
  }, [enabled, isInitialized, containerRef]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (videoRef.current?.srcObject) (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (canvasRef.current?.parentNode) canvasRef.current.parentNode.removeChild(canvasRef.current);
    imageSegmenterRef.current?.close();
    faceLandmarkerRef.current?.close();
  }, []);

  return (
    <>
      {isLoading && enabled && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-30 pointer-events-none">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-purple-500 border-t-transparent mx-auto mb-2" />
            <p className="text-white text-sm">Loading AR…</p>
          </div>
        </div>
      )}
      {error && enabled && (
        <div className="absolute top-2 left-2 right-2 bg-red-600/90 text-white px-3 py-2 rounded-lg text-sm z-30">
          ⚠️ {error}
        </div>
      )}
    </>
  );
}
