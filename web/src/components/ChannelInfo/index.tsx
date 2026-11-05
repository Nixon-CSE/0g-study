import React from 'react';

import { useApp } from '../../context/AppContext';
import { Container, HashtagIcon, Title, Separator, Description } from './styles';

const ChannelInfo: React.FC = () => {
  const { servers, activeServerId, activeChannelId } = useApp();
  const server = servers.find(s => s.id === activeServerId);
  const channel = server?.channels.find(c => c.id === activeChannelId);

  return (
    <Container>
      <HashtagIcon />
      <Title>{channel?.name || 'select a channel'}</Title>
      {channel?.description && (
        <>
          <Separator />
          <Description>{channel.description}</Description>
        </>
      )}
    </Container>
  );
};

export default ChannelInfo;
