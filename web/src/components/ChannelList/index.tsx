import React, { useState } from 'react';
import { Tooltip } from '@material-ui/core';
import styled from 'styled-components';
import { VolumeUp } from 'styled-icons/material';
import { Hashtag } from 'styled-icons/heroicons-outline';

import { useApp, ChannelType } from '../../context/AppContext';
import Modal, { Label, Input } from '../Modal';
import { useStyles } from '../../styles/MaterialUI';
import { Container, Category, AddCategoryIcon } from './styles';

const ChannelRow = styled.div<{ active?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  padding: 7px 6px;
  border-radius: 5px;
  background-color: ${({ active }) => (active ? 'var(--quinary)' : 'transparent')};
  transition: background-color 0.15s;
  margin-top: 2px;
  > div { display: flex; align-items: center; gap: 6px; }
  span { color: ${({ active }) => (active ? 'var(--white)' : 'var(--senary)')}; font-size: 14px; }
  &:hover { background-color: var(--quinary); span { color: var(--white); } }
`;

const VoiceIcon = styled(VolumeUp)`
  width: 20px; height: 20px; color: var(--symbol);
`;
const TextIcon = styled(Hashtag)`
  width: 20px; height: 20px; color: var(--symbol);
`;

const TypeToggle = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 4px;
`;

const TypeBtn = styled.button<{ selected: boolean }>`
  flex: 1;
  padding: 8px;
  border-radius: 4px;
  background: ${({ selected }) => (selected ? 'var(--discord)' : 'var(--quaternary)')};
  color: var(--white);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  border: none;
  transition: background 0.15s;
`;

const ChannelList: React.FC = () => {
  const classes = useStyles();
  const { servers, activeServerId, activeChannelId, setActiveChannel, createChannel } = useApp();

  const [showTextModal, setShowTextModal] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelDesc, setChannelDesc] = useState('');
  const [channelType, setChannelType] = useState<ChannelType>('text');

  const server = servers.find(s => s.id === activeServerId);
  const textChannels = server?.channels.filter(c => c.type === 'text') || [];
  const voiceChannels = server?.channels.filter(c => c.type === 'voice') || [];

  const openModal = (type: ChannelType) => {
    setChannelType(type);
    setChannelName('');
    setChannelDesc('');
    if (type === 'text') setShowTextModal(true);
    else setShowVoiceModal(true);
  };

  const handleCreate = () => {
    if (!channelName.trim() || !activeServerId) return;
    const safeName = channelName.trim().toLowerCase().replace(/\s+/g, '-');
    createChannel(activeServerId, safeName, channelType, channelDesc.trim());
    setShowTextModal(false);
    setShowVoiceModal(false);
  };

  const isModalOpen = showTextModal || showVoiceModal;
  const modalType: ChannelType = showTextModal ? 'text' : 'voice';

  return (
    <>
      <Container>
        <Category>
          <span>Text channels</span>
          <Tooltip title="Add Text Channel" placement="bottom" arrow classes={{ tooltip: classes.tooltip }}>
            <AddCategoryIcon onClick={() => openModal('text')} />
          </Tooltip>
        </Category>

        {textChannels.map(ch => (
          <ChannelRow
            key={ch.id}
            active={ch.id === activeChannelId}
            onClick={() => setActiveChannel(ch.id)}
          >
            <div>
              <TextIcon />
              <span>{ch.name}</span>
            </div>
          </ChannelRow>
        ))}

        <Category style={{ marginTop: 16 }}>
          <span>Voice channels</span>
          <Tooltip title="Add Voice Channel" placement="bottom" arrow classes={{ tooltip: classes.tooltip }}>
            <AddCategoryIcon onClick={() => openModal('voice')} />
          </Tooltip>
        </Category>

        {voiceChannels.map(ch => (
          <ChannelRow key={ch.id}>
            <div>
              <VoiceIcon />
              <span>{ch.name}</span>
            </div>
          </ChannelRow>
        ))}
      </Container>

      {isModalOpen && (
        <Modal
          title={`Create ${modalType === 'text' ? 'Text' : 'Voice'} Channel`}
          subtitle="Give your new channel a name."
          onClose={() => { setShowTextModal(false); setShowVoiceModal(false); }}
          onConfirm={handleCreate}
          confirmDisabled={!channelName.trim()}
        >
          <div>
            <Label>Channel Type</Label>
            <TypeToggle>
              <TypeBtn type="button" selected={modalType === 'text'} onClick={() => setChannelType('text')} disabled>
                Text
              </TypeBtn>
              <TypeBtn type="button" selected={modalType === 'voice'} onClick={() => setChannelType('voice')} disabled>
                Voice
              </TypeBtn>
            </TypeToggle>
          </div>
          <div>
            <Label>Channel Name</Label>
            <Input
              autoFocus
              value={channelName}
              onChange={e => setChannelName(e.target.value)}
              placeholder={modalType === 'text' ? 'new-channel' : 'General Voice'}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
            />
          </div>
          {modalType === 'text' && (
            <div>
              <Label>Topic (optional)</Label>
              <Input
                value={channelDesc}
                onChange={e => setChannelDesc(e.target.value)}
                placeholder="What is this channel about?"
              />
            </div>
          )}
        </Modal>
      )}
    </>
  );
};

export default ChannelList;
