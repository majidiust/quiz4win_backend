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
  type: 'background' | 'filter' | 'blur' | 'beauty' | 'preset-bg' | 'silhouette' | 'silhouette-bg' | 'none';
  icon: string;
  presetImage?: string;
  category?: 'backgrounds' | 'filters' | 'beauty' | 'none';
}

export interface SegmentationSettings {
  threshold: number;
  edgeSmoothing: number;
  alphaThreshold: number;
}

interface MediaPipeARProps {
  enabled?: boolean;
  selectedEffect?: AREffect | null;
  customBackgroundUrl?: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onReady?: () => void;
  onStreamReady?: (stream: MediaStream) => void;
  videoDeviceId?: string;
  segmentationSettings?: SegmentationSettings;
}

export default function MediaPipeAR({
  enabled = false,
  selectedEffect = null,
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
    if (!selectedEffect || !isInitialized) return;
    let imageUrl: string | null = null;
    if (selectedEffect.type === 'background' && customBackgroundUrl) imageUrl = customBackgroundUrl;
    else if (selectedEffect.type === 'preset-bg' && selectedEffect.presetImage) imageUrl = selectedEffect.presetImage;
    if (imageUrl) {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { backgroundImageRef.current = img; };
      img.src = imageUrl;
    } else { backgroundImageRef.current = null; }
  }, [selectedEffect, customBackgroundUrl, isInitialized]);

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
      const effect = selectedEffect;
      try {
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
        }
      } catch { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); }
      animationFrameRef.current = requestAnimationFrame(renderFrame);
    };
    renderFrame();
    return () => { if (animationFrameRef.current) { cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null; } };
  }, [enabled, isInitialized, selectedEffect]);

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
