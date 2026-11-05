import React, { useState, useRef } from 'react';
import { Tooltip } from '@material-ui/core';
import styled from 'styled-components';

import { useApp } from '../../context/AppContext';
import Modal, { Label, Input } from '../Modal';
import { useStyles } from '../../styles/MaterialUI';
import {
  Container, Profile, Avatar, UserData, Icons, Icon,
  MicIcon, MicOffIcon, VolumeIcon, VolumeOffIcon, SettingsIcon,
} from './styles';

const AvatarPreview = styled.div`
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--discord);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
  flex-shrink: 0;
  img { width: 72px; height: 72px; object-fit: cover; border-radius: 50%; }
  span { color: #fff; font-size: 26px; font-weight: 700; }
  &:hover { opacity: 0.85; }
`;

const AvatarHint = styled.p`
  color: var(--gray);
  font-size: 12px;
  margin-top: 4px;
  text-align: center;
`;

const ProfileRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`;

const DefaultAvatar = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--discord);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  font-size: 14px;
`;

const UserInfo: React.FC = () => {
  const classes = useStyles();
  const { user, updateUser } = useApp();

  const [muteMic, setMuteMic] = useState(false);
  const [muteAudio, setMuteAudio] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [editName, setEditName] = useState(user.username);
  const [editDiscriminator, setEditDiscriminator] = useState(user.discriminator);
  const [editAvatar, setEditAvatar] = useState<string | undefined>(user.avatar);

  const fileRef = useRef<HTMLInputElement>(null);

  const openSettings = () => {
    setEditName(user.username);
    setEditDiscriminator(user.discriminator);
    setEditAvatar(user.avatar);
    setShowSettings(true);
  };

  const handleSave = () => {
    updateUser({
      username: editName.trim() || user.username,
      discriminator: editDiscriminator || user.discriminator,
      avatar: editAvatar,
    });
    setShowSettings(false);
  };

  const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setEditAvatar(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const discriminator = user.discriminator.startsWith('#') ? user.discriminator : `#${user.discriminator}`;

  return (
    <>
      <Container>
        <Profile>
          <Avatar>
            {user.avatar
              ? <img src={user.avatar} alt={user.username} className="user-avatar" />
              : (
                <DefaultAvatar>
                  {user.username.charAt(0).toUpperCase()}
                </DefaultAvatar>
              )}
          </Avatar>
          <UserData>
            <strong>{user.username}</strong>
            <span>{discriminator}</span>
          </UserData>
        </Profile>

        <Icons>
          <Tooltip
            title={muteMic ? 'Unmute Microphone' : 'Mute Microphone'}
            placement="top"
            arrow
            classes={{ tooltip: classes.tooltip }}
          >
            <Icon onClick={() => setMuteMic(!muteMic)}>
              {muteMic ? <MicOffIcon /> : <MicIcon />}
            </Icon>
          </Tooltip>
          <Tooltip
            title={muteAudio ? 'Unmute Audio' : 'Mute Audio'}
            placement="top"
            arrow
            classes={{ tooltip: classes.tooltip }}
          >
            <Icon onClick={() => setMuteAudio(!muteAudio)}>
              {muteAudio ? <VolumeOffIcon /> : <VolumeIcon />}
            </Icon>
          </Tooltip>
          <Tooltip title="User Settings" placement="top" arrow classes={{ tooltip: classes.tooltip }}>
            <Icon onClick={openSettings}><SettingsIcon /></Icon>
          </Tooltip>
        </Icons>
      </Container>

      {showSettings && (
        <Modal
          title="User Settings"
          onClose={() => setShowSettings(false)}
          onConfirm={handleSave}
          confirmLabel="Save"
          confirmDisabled={!editName.trim()}
        >
          <ProfileRow>
            <div>
              <AvatarPreview onClick={() => fileRef.current?.click()}>
                {editAvatar
                  ? <img src={editAvatar} alt="avatar" />
                  : <span>{editName.charAt(0).toUpperCase() || 'U'}</span>}
              </AvatarPreview>
              <AvatarHint>Click to upload</AvatarHint>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleAvatarFile}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Label>Username</Label>
              <Input
                autoFocus
                value={editName}
                onChange={e => setEditName(e.target.value)}
                placeholder="Your username"
              />
            </div>
          </ProfileRow>
          <div>
            <Label>Discriminator</Label>
            <Input
              value={editDiscriminator}
              onChange={e => setEditDiscriminator(e.target.value)}
              placeholder="#0001"
            />
          </div>
        </Modal>
      )}
    </>
  );
};

export default UserInfo;
