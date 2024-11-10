import './ConsolePage.scss';
import Spline from '@splinetool/react-spline';
import React, { useState, useRef } from 'react';

export function ConsolePage() {
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const microphoneRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Start audio only when needed
  const startAudioStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setAudioStream(stream);

      // Set up audio context for processing the stream
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const microphone = audioContext.createMediaStreamSource(stream);
      microphoneRef.current = microphone;

      // Optionally adjust volume here (e.g., with GainNode)
    } catch (error) {
      console.error("Error accessing microphone: ", error);
    }
  };

  const stopAudioStream = () => {
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop()); // Stop all tracks
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    setAudioStream(null);
  };

  return (
    <div data-component="ConsolePage">
      <div className="content-main">
        <div className="content-logs">
          <div className="content-block events">
            <div className="spline-container" style={{ position: 'relative', width: '100%', height: '100%' }}>
            <Spline scene="https://prod.spline.design/zrVulpZcYp9v9dWD/scene.splinecode" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
