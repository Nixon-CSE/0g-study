import React from 'react';

import { useApp } from '../../context/AppContext';
import { Container, Role, User, Avatar } from './styles';

interface UserRowProps {
  nickname: string;
  isBot?: boolean;
  avatar?: string;
}

const DefaultAvatar = ({ initial }: { initial: string }) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--discord)',
      borderRadius: '50%',
      color: '#fff',
      fontSize: 13,
      fontWeight: 700,
    }}
  >
    {initial}
  </div>
);

const UserRow: React.FC<UserRowProps> = ({ nickname, isBot, avatar }) => (
  <User>
    <Avatar className={isBot ? 'bot' : ''}>
      {avatar
        ? <img src={avatar} alt={nickname} className="user-avatar" />
        : <DefaultAvatar initial={nickname.charAt(0).toUpperCase()} />}
    </Avatar>
    <strong>{nickname}</strong>
    {isBot && <span>Bot</span>}
  </User>
);

const UserList: React.FC = () => {
  const { servers, activeServerId } = useApp();
  const server = servers.find(s => s.id === activeServerId);
  const members = server?.members || [];

  const online = members.filter(m => m.online);
  const offline = members.filter(m => !m.online);

  return (
    <Container>
      {online.length > 0 && (
        <>
          <Role>
            {'Online — '}
            {online.length}
          </Role>
          {online.map(m => (
            <UserRow key={m.id} nickname={m.username} isBot={m.isBot} avatar={m.avatar} />
          ))}
        </>
      )}
      {offline.length > 0 && (
        <>
          <Role>
            {'Offline — '}
            {offline.length}
          </Role>
          {offline.map(m => (
            <UserRow key={m.id} nickname={m.username} isBot={m.isBot} avatar={m.avatar} />
          ))}
        </>
      )}
    </Container>
  );
};

export default UserList;
