import { useEffect, useRef, useCallback, useState } from 'react';
import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js';
import { WavRenderer } from '../utils/wav_renderer';
import { X, Edit, Zap } from 'react-feather';
import { Button } from '../components/button/Button';
import './VoiceChat.scss';

type Props = {
  scrapedContent: string;
};

export const VoiceChat: React.FC<Props> = ({ scrapedContent }) => {
  const apiKey = localStorage.getItem('tmp::voice_api_key') || '';
  const [items, setItems] = useState<ItemType[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const wavRecorderRef = useRef<WavRecorder>(new WavRecorder({ sampleRate: 24000 }));
  const clientRef = useRef<RealtimeClient>(
    new RealtimeClient({
      apiKey: apiKey,
      dangerouslyAllowAPIKeyInBrowser: true,
    })
  );

  const resetAPIKey = useCallback(() => {
    const newApiKey = prompt('OpenAI API Key');
    if (newApiKey !== null) {
      localStorage.setItem('tmp::voice_api_key', newApiKey);
      window.location.reload();
    }
  }, []);

  const connectConversation = useCallback(async () => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;

    setIsConnected(true);
    setItems(client.conversation.getItems());

    await wavRecorder.begin();
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
  }, []);

  const disconnectConversation = useCallback(async () => {
    setIsConnected(false);
    setItems([]);

    const client = clientRef.current;
    client.disconnect();

    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.end();
  }, []);

  const deleteConversationItem = useCallback(async (id: string) => {
    const client = clientRef.current;
    client.deleteItem(id);
  }, []);

  useEffect(() => {
    const client = clientRef.current;

    client.updateSession({ instructions: scrapedContent });
    client.updateSession({ input_audio_transcription: { model: 'whisper-1' } });
    client.updateSession({ voice: 'alloy' });

    client.on('error', (event: any) => console.error(event));
    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();
      setItems(items);
    });

    setItems(client.conversation.getItems());

    return () => {
      client.reset();
    };
  }, [scrapedContent]);

  return (
    <div data-component="VoiceChat">
      <div className="content-top">
        <div className="content-title">
          <span>AI Voice Agent</span>
        </div>
        <div className="content-api-key">
          <Button
            icon={Edit}
            iconPosition="end"
            buttonStyle="flush"
            label={`api key: ${apiKey.slice(0, 3)}...`}
            onClick={resetAPIKey}
          />
        </div>
      </div>
      <div className="content-main">
        <div className="content-logs">
          {items.length > 0 && (
            <div className="content-block conversation">
              <div className="content-block-body" data-conversation-content>
                {items.map((conversationItem) => (
                  <div className="conversation-item" key={conversationItem.id}>
                    <div className={`speaker ${conversationItem.role || ''}`}>
                      <div>
                        {(conversationItem.role || conversationItem.type).replaceAll('_', ' ')}
                      </div>
                      <div className="close" onClick={() => deleteConversationItem(conversationItem.id)}>
                        <X />
                      </div>
                    </div>
                    <div className={`speaker-content`}>
                      {conversationItem.formatted.transcript || conversationItem.formatted.text || '(truncated)'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="content-actions">
            <Button
              label={isConnected ? 'Disconnect' : 'Connect'}
              iconPosition={isConnected ? 'end' : 'start'}
              icon={isConnected ? X : Zap}
              buttonStyle={isConnected ? 'regular' : 'action'}
              onClick={isConnected ? disconnectConversation : connectConversation}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
