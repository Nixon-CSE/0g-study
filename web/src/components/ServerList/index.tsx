import React, { useState } from 'react';
import { Tooltip } from '@material-ui/core';

import { useApp } from '../../context/AppContext';
import Modal, { Label, Input, ColorRow, ColorSwatch, SERVER_COLORS } from '../Modal';
import { useStyles } from '../../styles/MaterialUI';
import { Container, ServerBtn, Separator, AddServerBtn, AddIcon } from './styles';

const ServerList: React.FC = () => {
  const classes = useStyles();
  const { servers, activeServerId, setActiveServer, createServer } = useApp();
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(SERVER_COLORS[0]);

  const handleCreate = () => {
    if (!name.trim()) return;
    createServer(name.trim(), color);
    setName('');
    setColor(SERVER_COLORS[0]);
    setShowModal(false);
  };

  return (
    <>
      <Container>
        {servers.map((server, i) => (
          <React.Fragment key={server.id}>
            {i === 1 && <Separator />}
            <Tooltip title={server.name} placement="right" arrow classes={{ tooltip: classes.tooltip }}>
              <ServerBtn
                type="button"
                active={activeServerId === server.id}
                bgColor={server.color}
                onClick={() => setActiveServer(server.id)}
                aria-label={server.name}
              >
                {server.logo
                  ? <img src={server.logo} alt={server.name} />
                  : <span>{server.name.charAt(0).toUpperCase()}</span>}
              </ServerBtn>
            </Tooltip>
          </React.Fragment>
        ))}

        <Separator />

        <Tooltip title="Add a Server" placement="right" arrow classes={{ tooltip: classes.tooltip }}>
          <AddServerBtn type="button" onClick={() => setShowModal(true)} aria-label="Add Server">
            <AddIcon />
          </AddServerBtn>
        </Tooltip>
      </Container>

      {showModal && (
        <Modal
          title="Create a Server"
          subtitle="Give your server a name and pick a color."
          onClose={() => setShowModal(false)}
          onConfirm={handleCreate}
          confirmDisabled={!name.trim()}
        >
          <div>
            <Label>Server Name</Label>
            <Input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="My Awesome Server"
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
            />
          </div>
          <div>
            <Label>Server Color</Label>
            <ColorRow>
              {SERVER_COLORS.map(c => (
                <ColorSwatch key={c} color={c} selected={color === c} onClick={() => setColor(c)} />
              ))}
            </ColorRow>
          </div>
        </Modal>
      )}
    </>
  );
};

export default ServerList;
