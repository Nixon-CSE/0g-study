import React, { useRef, useEffect, useState, KeyboardEvent } from 'react';

import { useApp } from '../../context/AppContext';
import ChannelMessage from '../ChannelMessage';
import { Container, Messages, InputWrapper, Input, InputIcon } from './styles';

const ChannelData: React.FC = () => {
  const { servers, activeServerId, activeChannelId, sendMessage } = useApp();
  const messagesRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');

  const server = servers.find(s => s.id === activeServerId);
  const channel = server?.channels.find(c => c.id === activeChannelId);
  const messages = channel?.messages || [];

  useEffect(() => {
    const div = messagesRef.current;
    if (div) div.scrollTop = div.scrollHeight;
  }, [messages]);

  const handleSend = () => {
    if (!text.trim() || !activeServerId || !activeChannelId) return;
    sendMessage(activeServerId, activeChannelId, text);
    setText('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSend();
  };

  if (channel?.type === 'voice') {
    return (
      <Container style={{ alignItems: 'center', justifyContent: 'center', color: 'var(--gray)', fontSize: 15 }}>
        <span>
          🔊 Voice channel — #
          {channel.name}
        </span>
        <p style={{ marginTop: 8, fontSize: 13 }}>Voice functionality coming soon.</p>
      </Container>
    );
  }

  return (
    <Container>
      <Messages ref={messagesRef}>
        {messages.length === 0 && (
          <p style={{ color: 'var(--gray)', textAlign: 'center', marginTop: 40, fontSize: 14 }}>
            No messages yet. Be the first to say something!
          </p>
        )}
        {messages.map(msg => (
          <ChannelMessage
            key={msg.id}
            author={msg.author}
            date={msg.date}
            content={msg.content}
            isBot={msg.isBot}
            avatar={msg.avatar}
          />
        ))}
      </Messages>

      <InputWrapper>
        <Input
          type="text"
          placeholder={channel ? `Message #${channel.name}` : 'Select a channel'}
          disabled={!channel}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <InputIcon />
      </InputWrapper>
    </Container>
  );
};

export default ChannelData;
