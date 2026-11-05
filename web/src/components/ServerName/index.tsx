import React, { useState } from 'react';
import { Tooltip } from '@material-ui/core';
import styled from 'styled-components';
import { PersonAdd } from 'styled-icons/material';

import { useApp } from '../../context/AppContext';
import Modal, { Label, Input } from '../Modal';
import { useStyles } from '../../styles/MaterialUI';
import { Container, Title, ExpandIcon } from './styles';

const AddBotBtn = styled.button`
  display: flex;
  align-items: center;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--gray);
  padding: 4px;
  border-radius: 4px;
  &:hover { color: var(--white); }
`;

const AddBotIcon = styled(PersonAdd)`
  width: 20px;
  height: 20px;
`;

const BotList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 160px;
  overflow-y: auto;
`;

const BotItem = styled.div`
  padding: 8px 12px;
  background: var(--quaternary);
  border-radius: 4px;
  color: var(--white);
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  span { color: var(--discord); font-size: 11px; background: rgba(110,134,214,0.2); padding: 2px 6px; border-radius: 8px; }
`;

const ClickableBotItem = styled(BotItem)`
  cursor: pointer;
  &:hover { background: var(--quinary); }
`;

const PRESET_BOTS = ['MEE6', 'Carl-bot', 'Dyno', 'Hydra', 'Groovy', 'Rythm', 'YAGPDB', 'Ticket Tool'];

const ServerName: React.FC = () => {
  const classes = useStyles();
  const { servers, activeServerId, addBot } = useApp();
  const [showModal, setShowModal] = useState(false);
  const [botName, setBotName] = useState('');

  const server = servers.find(s => s.id === activeServerId);

  const handleAdd = () => {
    if (!botName.trim() || !activeServerId) return;
    addBot(activeServerId, botName.trim());
    setBotName('');
    setShowModal(false);
  };

  return (
    <>
      <Container>
        <Title>{server?.name || 'Select a Server'}</Title>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {server && (
            <Tooltip title="Add Bot" placement="bottom" arrow classes={{ tooltip: classes.tooltip }}>
              <AddBotBtn type="button" onClick={() => setShowModal(true)} aria-label="Add Bot">
                <AddBotIcon />
              </AddBotBtn>
            </Tooltip>
          )}
          <ExpandIcon />
        </div>
      </Container>

      {showModal && (
        <Modal
          title="Add a Bot"
          subtitle="Choose a preset bot or enter a custom bot name."
          onClose={() => setShowModal(false)}
          onConfirm={handleAdd}
          confirmLabel="Add Bot"
          confirmDisabled={!botName.trim()}
        >
          <div>
            <Label>Bot Name</Label>
            <Input
              autoFocus
              value={botName}
              onChange={e => setBotName(e.target.value)}
              placeholder="Enter bot name"
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            />
          </div>

          <div>
            <Label>Or pick a popular bot</Label>
            <BotList>
              {PRESET_BOTS.map(b => (
                <ClickableBotItem key={b} onClick={() => setBotName(b)}>
                  <span>Bot</span>
                  {b}
                </ClickableBotItem>
              ))}
            </BotList>
          </div>

          {server && server.bots.length > 0 && (
            <div>
              <Label>
                Bots in this server (
                {server.bots.length}
                )
              </Label>
              <BotList>
                {server.bots.map(b => (
                  <BotItem key={b.id}>
                    <span>Bot</span>
                    {b.name}
                  </BotItem>
                ))}
              </BotList>
            </div>
          )}
        </Modal>
      )}
    </>
  );
};

export default ServerName;
