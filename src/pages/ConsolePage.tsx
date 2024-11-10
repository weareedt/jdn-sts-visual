/**
 * Running a local relay server will allow you to hide your API key
 * and run custom logic on the server
 *
 * Set the local relay server address to:
 * REACT_APP_LOCAL_RELAY_SERVER_URL=http://localhost:8081
 *
 * This will also require you to set OPENAI_API_KEY= in a `.env` file
 * You can run it with `npm run relay`, in parallel with `npm start`
 */
const LOCAL_RELAY_SERVER_URL: string =
  process.env.REACT_APP_LOCAL_RELAY_SERVER_URL || '';

import { useEffect, useRef, useCallback, useState } from 'react';

import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js';
import { instructions } from '../utils/conversation_config.js';
import { WavRenderer } from '../utils/wav_renderer';

import { X, Edit, Zap, ArrowUp, ArrowDown } from 'react-feather';
import { Button } from '../components/button/Button';
import { Toggle } from '../components/toggle/Toggle';
import { Map } from '../components/Map';
import chatIcon from '../assets/topic.svg'; 

import './ConsolePage.scss';
import * as THREE from 'three';
import { vertexShader, fragmentShader } from '../utils/shaders';

/**
 * Type for result from get_weather() function call
 */
interface Coordinates {
  lat: number;
  lng: number;
  location?: string;
  temperature?: {
    value: number;
    units: string;
  };
  wind_speed?: {
    value: number;
    units: string;
  };
}

/**
 * Type for all event logs
 */
interface RealtimeEvent {
  time: string;
  source: 'client' | 'server';
  count?: number;
  event: { [key: string]: any };
}

export function ConsolePage() {
  /**
   * Ask user for API Key
   * If we're using the local relay server, we don't need this
   */
  const apiKey = LOCAL_RELAY_SERVER_URL
    ? ''
    : localStorage.getItem('tmp::voice_api_key') ||
      prompt('OpenAI API Key') ||
      '';
  if (apiKey !== '') {
    localStorage.setItem('tmp::voice_api_key', apiKey);
  }

  /**
   * Instantiate:
   * - WavRecorder (speech input)
   * - WavStreamPlayer (speech output)
   * - RealtimeClient (API client)
   * - Toggle Dev Board (ESC Button)
   */
  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );
  const wavStreamPlayerRef = useRef<WavStreamPlayer>(
    new WavStreamPlayer({ sampleRate: 24000 })
  );
  const clientRef = useRef<RealtimeClient>(
    new RealtimeClient(
      LOCAL_RELAY_SERVER_URL
        ? { url: LOCAL_RELAY_SERVER_URL }
        : {
            apiKey: apiKey,
            dangerouslyAllowAPIKeyInBrowser: true,
          }
    )
  );
  const contentTopRef = useRef<HTMLDivElement | null>(null);

  /**
   * References for
   * - Rendering audio visualization (canvas)
   * - Autoscrolling event logs
   * - Timing delta for event log displays
   */
  const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  const serverCanvasRef = useRef<HTMLCanvasElement>(null);
  const eventsScrollHeightRef = useRef(0);
  const eventsScrollRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<string>(new Date().toISOString());

  /**
   * All of our variables for displaying application state
   * - items are all conversation items (dialog)
   * - realtimeEvents are event logs, which can be expanded
   * - memoryKv is for set_memory() function
   * - coords, marker are for get_weather() function
   */
  const [items, setItems] = useState<ItemType[]>([]);
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [expandedEvents, setExpandedEvents] = useState<{
    [key: string]: boolean;
  }>({});
  const [isConnected, setIsConnected] = useState(false);
  const [canPushToTalk, setCanPushToTalk] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [memoryKv, setMemoryKv] = useState<{ [key: string]: any }>({});
  const [coords, setCoords] = useState<Coordinates | null>({
    lat: 37.775593,
    lng: -122.418137,
  });
  const [marker, setMarker] = useState<Coordinates | null>(null);

  // Add state for audio data
  const [audioData, setAudioData] = useState(new Uint8Array(0));

  // Add state for minimizing chat
  const [isMinimized, setIsMinimized] = useState(true);

  const mountRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [sound, setSound] = useState<THREE.Audio | null>(null);
  const [analyser, setAnalyser] = useState<THREE.AudioAnalyser | null>(null);
  const [audioContextInitialized, setAudioContextInitialized] = useState(false);

  // Add new state for audio initialization
  const [isAudioInitialized, setIsAudioInitialized] = useState(false);

  const [isColorControlVisible, setIsColorControlVisible] = useState(true);

  const [animationColor, setAnimationColor] = useState('#ffff00');

  /**
   * Utility for formatting the timing of logs
   */
  const formatTime = useCallback((timestamp: string) => {
    const startTime = startTimeRef.current;
    const t0 = new Date(startTime).valueOf();
    const t1 = new Date(timestamp).valueOf();
    const delta = t1 - t0;
    const hs = Math.floor(delta / 10) % 100;
    const s = Math.floor(delta / 1000) % 60;
    const m = Math.floor(delta / 60_000) % 60;
    const pad = (n: number) => {
      let s = n + '';
      while (s.length < 2) {
        s = '0' + s;
      }
      return s;
    };
    return `${pad(m)}:${pad(s)}.${pad(hs)}`;
  }, []);

  /**
   * When you click the API key
   */
  const resetAPIKey = useCallback(() => {
    const apiKey = prompt('OpenAI API Key');
    if (apiKey !== null) {
      localStorage.clear();
      localStorage.setItem('tmp::voice_api_key', apiKey);
      window.location.reload();
    }
  }, []);

  /**
   * Connect to conversation:
   * WavRecorder taks speech input, WavStreamPlayer output, client is API client
   */
  const connectConversation = useCallback(async () => {
    const client = clientRef.current;
    
    // Always create a new WavRecorder instance when connecting
    wavRecorderRef.current = new WavRecorder({ sampleRate: 24000 });
    const wavRecorder = wavRecorderRef.current;
    
    const wavStreamPlayer = wavStreamPlayerRef.current;

    // Set state variables
    startTimeRef.current = new Date().toISOString();
    setIsConnected(true);
    setRealtimeEvents([]);
    setItems(client.conversation.getItems());

    try {
      // Connect to microphone
      await wavRecorder.begin();

      // Connect to audio output
      await wavStreamPlayer.connect();

      // Connect to realtime API
      await client.connect();
      client.sendUserMessageContent([
        {
          type: `input_text`,
          text: `Hello!`,
        },
      ]);

      if (client.getTurnDetectionType() === 'server_vad') {
        await wavRecorder.record((data) => client.appendInputAudio(data.mono));
      }
    } catch (error) {
      console.error("Error connecting:", error);
      setIsConnected(false);
    }
  }, []);

  /**
   * Disconnect and reset conversation state
   */
  const disconnectConversation = useCallback(async () => {
    setIsConnected(false);
    setRealtimeEvents([]);
    setItems([]);
    setMemoryKv({});
    setCoords({
      lat: 37.775593,
      lng: -122.418137,
    });
    setMarker(null);

    const client = clientRef.current;
    client.disconnect();

    const wavRecorder = wavRecorderRef.current;
    // Check if the wavRecorder is in a recording state before ending
    if (wavRecorder.getStatus() === 'recording') {
      await wavRecorder.end();
    }

    const wavStreamPlayer = wavStreamPlayerRef.current;
    await wavStreamPlayer.interrupt();
  }, []);

  const deleteConversationItem = useCallback(async (id: string) => {
    const client = clientRef.current;
    client.deleteItem(id);
  }, []);

  const toggleContentTopDisplay = () => {
    if (contentTopRef.current) {
      const currentDisplay = window.getComputedStyle(contentTopRef.current).display;
      contentTopRef.current.style.display = currentDisplay === 'none' ? 'flex' : 'none';
    }
  };

  /**
   * In push-to-talk mode, start recording
   * .appendInputAudio() for each sample
   */
  const startRecording = async () => {
    setIsRecording(true);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const trackSampleOffset = await wavStreamPlayer.interrupt();
    if (trackSampleOffset?.trackId) {
      const { trackId, offset } = trackSampleOffset;
      await client.cancelResponse(trackId, offset);
    }
    await wavRecorder.record((data) => client.appendInputAudio(data.mono));
  };

  /**
   * In push-to-talk mode, stop recording
   */
  const stopRecording = async () => {
    setIsRecording(false);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.pause();
    client.createResponse();
  };

  /**
   * Switch between Manual <> VAD mode for communication
   */
  const changeTurnEndType = async (value: string) => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    if (value === 'none' && wavRecorder.getStatus() === 'recording') {
      await wavRecorder.pause();
    }
    client.updateSession({
      turn_detection: value === 'none' ? null : { type: 'server_vad' },
    });
    if (value === 'server_vad' && client.isConnected()) {
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
    setCanPushToTalk(value === 'none');
  };

  // Function to toggle minimized state
  const toggleMinimize = () => {
    setIsMinimized((prev) => !prev);
  };

  /**
   * Auto-scroll the event logs
   */
  useEffect(() => {
    if (eventsScrollRef.current) {
      const eventsEl = eventsScrollRef.current;
      const scrollHeight = eventsEl.scrollHeight;
      // Only scroll if height has just changed
      if (scrollHeight !== eventsScrollHeightRef.current) {
        eventsEl.scrollTop = scrollHeight;
        eventsScrollHeightRef.current = scrollHeight;
      }
    }
  }, [realtimeEvents]);

  /**
   * Auto-scroll the conversation logs
   */
  useEffect(() => {
    const conversationEls = [].slice.call(
      document.body.querySelectorAll('[data-conversation-content]')
    );
    for (const el of conversationEls) {
      const conversationEl = el as HTMLDivElement;
      conversationEl.scrollTop = conversationEl.scrollHeight;
    }
  }, [items]);

  /**
   * Set up render loops for the visualization canvas
   */
  useEffect(() => {
    let isLoaded = true;

    const wavRecorder = wavRecorderRef.current;
    const clientCanvas = clientCanvasRef.current;
    let clientCtx: CanvasRenderingContext2D | null = null;

    const wavStreamPlayer = wavStreamPlayerRef.current;
    const serverCanvas = serverCanvasRef.current;
    let serverCtx: CanvasRenderingContext2D | null = null;

    const render = () => {
      if (isLoaded) {
        if (clientCanvas) {
          if (!clientCanvas.width || !clientCanvas.height) {
            clientCanvas.width = clientCanvas.offsetWidth;
            clientCanvas.height = clientCanvas.offsetHeight;
          }
          clientCtx = clientCtx || clientCanvas.getContext('2d');
          if (clientCtx) {
            clientCtx.clearRect(0, 0, clientCanvas.width, clientCanvas.height);
            const result = wavRecorder.recording
              ? wavRecorder.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              clientCanvas,
              clientCtx,
              result.values,
              '#0099ff',
              10,
              0,
              8
            );
          }
        }
        if (serverCanvas) {
          if (!serverCanvas.width || !serverCanvas.height) {
            serverCanvas.width = serverCanvas.offsetWidth;
            serverCanvas.height = serverCanvas.offsetHeight;
          }
          serverCtx = serverCtx || serverCanvas.getContext('2d');
          if (serverCtx) {
            serverCtx.clearRect(0, 0, serverCanvas.width, serverCanvas.height);
            const result = wavStreamPlayer.analyser
              ? wavStreamPlayer.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              serverCanvas,
              serverCtx,
              result.values,
              '#009900',
              10,
              0,
              8
            );
          }
        }
        window.requestAnimationFrame(render);
      }
    };
    render();

    // Set up audio data update
    const updateAudioData = () => {
      const data = wavRecorder.recording
        ? wavRecorder.getFrequencies('voice').values
        : wavStreamPlayer.analyser
        ? wavStreamPlayer.getFrequencies('voice').values
        : new Float32Array(128);
      setAudioData(new Uint8Array(data));
      if (isLoaded) {
        requestAnimationFrame(updateAudioData);
      }
    };

    updateAudioData();

    return () => {
      isLoaded = false;
    };
  }, []);

  /**
   * Core RealtimeClient and audio capture setup
   * Set all of our instructions, tools, events and more
   */
  useEffect(() => {
    // Get refs
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const client = clientRef.current;

    // Set instructions
    client.updateSession({ instructions: instructions });
    // Set transcription, otherwise we don't get user transcriptions back
    client.updateSession({ input_audio_transcription: { model: 'whisper-1' } });

    // Add tools
    client.addTool(
      {
        name: 'set_memory',
        description: 'Saves important data about the user into memory.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description:
                'The key of the memory value. Always use lowercase and underscores, no other characters.',
            },
            value: {
              type: 'string',
              description: 'Value can be anything represented as a string',
            },
          },
          required: ['key', 'value'],
        },
      },
      async ({ key, value }: { [key: string]: any }) => {
        setMemoryKv((memoryKv) => {
          const newKv = { ...memoryKv };
          newKv[key] = value;
          return newKv;
        });
        return { ok: true };
      }
    );

    // handle realtime events from client + server for event logging
    client.on('realtime.event', (realtimeEvent: RealtimeEvent) => {
      setRealtimeEvents((realtimeEvents) => {
        const lastEvent = realtimeEvents[realtimeEvents.length - 1];
        if (lastEvent?.event.type === realtimeEvent.event.type) {
          // if we receive multiple events in a row, aggregate them for display purposes
          lastEvent.count = (lastEvent.count || 0) + 1;
          return realtimeEvents.slice(0, -1).concat(lastEvent);
        } else {
          return realtimeEvents.concat(realtimeEvent);
        }
      });
    });
    client.on('error', (event: any) => console.error(event));
    client.on('conversation.interrupted', async () => {
      const trackSampleOffset = await wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId) {
        const { trackId, offset } = trackSampleOffset;
        await client.cancelResponse(trackId, offset);
      }
    });
    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();
      if (delta?.audio) {
        wavStreamPlayer.add16BitPCM(delta.audio, item.id);
      }
      if (item.status === 'completed' && item.formatted.audio?.length) {
        const wavFile = await WavRecorder.decode(
          item.formatted.audio,
          24000,
          24000
        );
        item.formatted.file = wavFile;
      }
      setItems(items);
    });

    setItems(client.conversation.getItems());

    return () => {
      // cleanup; resets to defaults
      client.reset();
    };
  }, []);

  // Create a function to handle the click on the sphere
  const handleSphereClick = async () => {
    if (!isAudioInitialized) {
      try {
        // Initialize audio context
        const newAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        setAudioContext(newAudioContext);
        
        // Initialize analyser and other audio components
        const analyser = newAudioContext.createAnalyser();
        analyser.fftSize = 256;
        
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = newAudioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        
        setIsAudioInitialized(true);
      } catch (error) {
        console.error("Error initializing audio:", error);
      }
    }
  };

  // Function to toggle color control visibility
  const toggleColorControl = () => {
    setIsColorControlVisible((prev) => !prev);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        toggleContentTopDisplay();
        toggleColorControl();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Function to handle color change
  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedColor = e.target.value;
    setAnimationColor(selectedColor);

    const rgbColor = new THREE.Color(selectedColor);
    if (shaderMaterialRef.current) {
      shaderMaterialRef.current.uniforms.u_color1.value.setRGB(
        rgbColor.r,
        rgbColor.g,
        rgbColor.b
      );
      shaderMaterialRef.current.uniforms.u_color2.value.setRGB(
        rgbColor.r,
        rgbColor.g,
        rgbColor.b
      );
    }
  };

  // Create a ref for the shader material
  const shaderMaterialRef = useRef<THREE.ShaderMaterial | null>(null);

  useEffect(() => {
    // Modify the sphere creation in the useEffect
    if (!mountRef.current) return;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    mountRef.current.appendChild(renderer.domElement);

    camera.position.z = 14;

    const geometry = new THREE.IcosahedronGeometry(2, 10);
    
    const shaderMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        u_time: { value: 0.0 },
        u_amplitude: { value: 0.0 },
        u_explosiveness: { value: 0.0 },
        u_avgVolume: { value: 0.0 },
        u_color1: { value: new THREE.Color(animationColor) },
        u_color2: { value: new THREE.Color(animationColor) },
      },
      wireframe: true,
      //transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });

    shaderMaterialRef.current = shaderMaterial;

    const sphere = new THREE.Mesh(geometry, shaderMaterial);
    sphere.userData.clickable = true;
    scene.add(sphere);

    // Add click event listener to the renderer's canvas
    const onClick = (event: MouseEvent) => {
      const canvas = renderer.domElement;
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2(x, y);
      raycaster.setFromCamera(mouse, camera);

      const intersects = raycaster.intersectObjects(scene.children);
      if (intersects.length > 0 && intersects[0].object.userData.clickable) {
        handleSphereClick();
      }
    };

    renderer.domElement.addEventListener('click', onClick);

    // Audio setup
    let audioContext: AudioContext;
    let analyser: AnalyserNode;

    const initAudio = async () => {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
      } catch (error) {
        console.error("Error accessing the microphone", error);
      }
    };

    initAudio();

    const updateGeometry = (detail: number) => {
      const newGeometry = new THREE.IcosahedronGeometry(2, detail);
      sphere.geometry.dispose(); // Dispose of the old geometry
      sphere.geometry = newGeometry; // Assign the new geometry
    };

    const animate = () => {
      requestAnimationFrame(animate);

      shaderMaterial.uniforms.u_time.value += 0.01;

      if (analyser) {
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        const normalizedAverage = average / 255;

        // Define animation styles
        const calmAndSmooth = () => {
          shaderMaterial.uniforms.u_avgVolume.value = normalizedAverage;
          shaderMaterial.uniforms.u_amplitude.value = 1.0;
          shaderMaterial.uniforms.u_explosiveness.value = 0.6;
          updateColor(140); // Green
          updateGeometry(5); // 5 polygons
        };

        const moderate = () => {
          shaderMaterial.uniforms.u_avgVolume.value = normalizedAverage;
          shaderMaterial.uniforms.u_amplitude.value = Math.min(1.0 + normalizedAverage * 0.8, 0.5);
          shaderMaterial.uniforms.u_explosiveness.value = 0.8;
          updateColor(140); // Light Green
          updateGeometry(25); // 20 polygons
        };

        const sharpAndAggressive = () => {
          shaderMaterial.uniforms.u_avgVolume.value = normalizedAverage;
          shaderMaterial.uniforms.u_amplitude.value = Math.min(1.0 + normalizedAverage * 2.0, 2.0);
          shaderMaterial.uniforms.u_explosiveness.value = 1.2;
          updateColor(140); // Dark Green
          updateGeometry(30); // 15 polygons
        };

        // Choose the animation style based on a condition
        const animationStyle: number = 2; // Change this value to switch between styles (1-4)
        switch (animationStyle) {
          case 1:
            calmAndSmooth();
            break;
          case 2:
            moderate();
            break;
          case 3:
            sharpAndAggressive();
            break;

          default:
            calmAndSmooth();
        }
      } else {
        shaderMaterial.uniforms.u_avgVolume.value = 0.0;
        shaderMaterial.uniforms.u_amplitude.value = 1.0;
        shaderMaterial.uniforms.u_explosiveness.value = 0.2;
      }

      renderer.render(scene, camera);
    };

    const updateColor = (baseHue: number) => {
      const hueVariation = (Math.sin(shaderMaterial.uniforms.u_time.value) + 1) * 15; // Vary hue
      const hue = (baseHue + hueVariation) % 360;
      const color = new THREE.Color(`hsl(${hue}, 100%, 50%)`);
      shaderMaterial.uniforms.u_color1.value.set(color);
      shaderMaterial.uniforms.u_color2.value.set(color);
    };

    animate();

    // Resize handler
    const handleResize = () => {
      if (!mountRef.current) return;
      const width = mountRef.current.clientWidth;
      const height = mountRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      mountRef.current?.removeChild(renderer.domElement);
      if (audioContext) {
        audioContext.close();
      }
    };
  }, [animationColor]); // Add animationColor to dependencies

  const initializeAudio = () => {
    if (!audioContext) {
      const newAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      setAudioContext(newAudioContext);
      const listener = new THREE.AudioListener();
      const newSound = new THREE.Audio(listener);
      setSound(newSound);
      setAnalyser(new THREE.AudioAnalyser(newSound, 32));

      const audioLoader = new THREE.AudioLoader();
      audioLoader.load('/static/Beats.mp3', (buffer) => {
        newSound.setBuffer(buffer);
        newSound.setLoop(true);
        newSound.setVolume(0.5);
      });
    }
  };

  const handleStartPause = () => {
    initializeAudio();
    if (isPlaying && sound) {
      sound.pause();
    } else if (sound) {
      sound.play();
    }
    setIsPlaying(!isPlaying);
  };

  /**
   * Render the application
   */
  
  return (
    <div data-component="ConsolePage">
      <div className="content-top" ref={contentTopRef} style={{ maxHeight: '60px', overflow: 'hidden' }}>
        <div className="content-api-key">
          {!LOCAL_RELAY_SERVER_URL && (
            <Button
              icon={Edit}
              iconPosition="end"
              buttonStyle="flush"
              label={`api key: ${apiKey.slice(0, 3)}...`}
              onClick={() => resetAPIKey()}
            />
          )}
        </div>
        
        <div className="action-button" style={{ position: 'absolute', top: '10px', right: '16px' }}>
          <Button
            icon={isConnected ? X : Zap}
            iconPosition={isConnected ? 'end' : 'start'}
            buttonStyle={isConnected ? 'regular' : 'action'}
            label={isConnected ? 'disconnect' : 'connect'}
            onClick={
              isConnected ? disconnectConversation : connectConversation
            }
          />
        </div>
      </div>
      <div className="content-main">
  
        <div className="content-logs">
          <div className="content-block events">
            <div 
              className="visualization" 
              ref={mountRef} 
              style={{ 
                width: '100%', 
                height: '100%',
              }}
              >
                {/* Centered overlay log text displaying the last assistant's message */}
                  {items.length > 0 && items[items.length - 1].role === 'assistant' && (
                    <div className="overlay-log">
                      {items[items.length - 1].formatted.transcript ||
                        items[items.length - 1].formatted.text ||
                        '(No content available)'}
                    </div>
                  )}
              </div>
            </div>
          <div className={`chat-window ${isMinimized ? 'minimized' : ''}`}>
            <div className="chat-header" onClick={toggleMinimize}>
              <img src={chatIcon} alt="Topic Icon" className="topic-icon"/>
              {!isMinimized && <div className="header-title">Chat</div>} {/* Only show title when not minimized */}
              <div className="header-controls">
                <button className="triangle-button">
                  {isMinimized ? '' : 'Min'} {/* Change button text based on state */}
                </button>
              </div>
            </div>
            {!isMinimized && (
              <div className="chat-content">
                <div className="content-block-title">Conversation</div>
                <div className="content-block-body" data-conversation-content>
                  {!items.length && `awaiting connection..`}
                  {items.map((conversationItem, i) => {
                    return (
                      <div className="conversation-item" key={conversationItem.id}>
                        <div className={`speaker ${conversationItem.role || ''}`}>
                          <div>
                            {(
                              conversationItem.role || conversationItem.type
                            ).replaceAll('_', ' ')}
                          </div>
                          <div
                            className="close"
                            onClick={() =>
                              deleteConversationItem(conversationItem.id)
                            }
                          >
                            <X />
                          </div>
                        </div>
                        <div className={`speaker-content`} style={{ color: 'white' }}>
                          {/* tool response */}
                          {conversationItem.type === 'function_call_output' && (
                            <div>{conversationItem.formatted.output}</div>
                          )}
                          {/* tool call */}
                          {!!conversationItem.formatted.tool && (
                            <div>
                              {conversationItem.formatted.tool.name}(
                              {conversationItem.formatted.tool.arguments})
                            </div>
                          )}
                          {!conversationItem.formatted.tool &&
                            conversationItem.role === 'user' && (
                              <div>
                                {conversationItem.formatted.transcript ||
                                  (conversationItem.formatted.audio?.length
                                    ? '(awaiting transcript)'
                                    : conversationItem.formatted.text ||
                                      '(item sent)')}
                              </div>
                            )}
                          {!conversationItem.formatted.tool &&
                            conversationItem.role === 'assistant' && (
                              <div>
                                {conversationItem.formatted.transcript ||
                                  conversationItem.formatted.text ||
                                  '(truncated)'}
                              </div>
                            )}
                          {conversationItem.formatted.file && (
                            <audio
                              src={conversationItem.formatted.file.url}
                              controls
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="content-actions">
            <div className="toggle-container"> {/* Add a wrapper div here */}
              <Toggle
                defaultValue={false}
                labels={['manual', 'vad']}
                values={['none', 'server_vad']}
                onChange={(_, value) => changeTurnEndType(value)}
              />
            </div>
            <div className="spacer" />
            {isConnected && canPushToTalk && (
              <Button
                className="push-to-talk"
                label={isRecording ? 'Release to send' : 'Push to talk'}
                buttonStyle={isRecording ? 'alert' : 'regular'}
                disabled={!isConnected || !canPushToTalk}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
              />
            )}
            <div className="spacer" />
          </div>
        </div>
      </div>
    </div>
  );
}
