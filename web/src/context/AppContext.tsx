import React, { createContext, useContext, useState, useCallback } from 'react';

export type ChannelType = 'text' | 'voice';

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  description?: string;
  messages: Message[];
}

export interface Message {
  id: string;
  author: string;
  authorId: string;
  avatar?: string;
  content: string;
  date: string;
  isBot?: boolean;
}

export interface Bot {
  id: string;
  name: string;
  avatar?: string;
}

export interface Server {
  id: string;
  name: string;
  color: string;
  logo?: string;
  channels: Channel[];
  bots: Bot[];
  members: Member[];
}

export interface Member {
  id: string;
  username: string;
  discriminator: string;
  avatar?: string;
  isBot?: boolean;
  online?: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  discriminator: string;
  avatar?: string;
}

interface AppContextValue {
  user: UserProfile;
  setUser: (u: UserProfile) => void;
  servers: Server[];
  activeServerId: string;
  activeChannelId: string;
  setActiveServer: (id: string) => void;
  setActiveChannel: (id: string) => void;
  createServer: (name: string, color: string) => void;
  createChannel: (serverId: string, name: string, type: ChannelType, description?: string) => void;
  deleteChannel: (serverId: string, channelId: string) => void;
  addBot: (serverId: string, botName: string) => void;
  sendMessage: (serverId: string, channelId: string, content: string) => void;
  updateUser: (profile: Partial<UserProfile>) => void;
}

const defaultUser: UserProfile = {
  id: 'me',
  username: 'You',
  discriminator: '#0001',
};

const defaultServers: Server[] = [
  {
    id: 'server-1',
    name: 'My First Server',
    color: '#cc78a3',
    channels: [
      {
        id: 'ch-1',
        name: 'general',
        type: 'text',
        description: 'General chat for everyone',
        messages: [
          {
            id: 'msg-1',
            author: 'System',
            authorId: 'system',
            content: 'Welcome to My First Server! This is the beginning of #general.',
            date: new Date().toLocaleDateString(),
            isBot: true,
          },
        ],
      },
      {
        id: 'ch-2',
        name: 'General Voice',
        type: 'voice',
        description: '',
        messages: [],
      },
    ],
    bots: [],
    members: [
      { id: 'me', username: 'You', discriminator: '#0001', online: true },
    ],
  },
];

const AppContext = createContext<AppContextValue | null>(null);

let nextId = 100;
const uid = () => { nextId += 1; return String(nextId); };

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUserState] = useState<UserProfile>(defaultUser);
  const [servers, setServers] = useState<Server[]>(defaultServers);
  const [activeServerId, setActiveServerId] = useState(defaultServers[0].id);
  const [activeChannelId, setActiveChannelId] = useState(defaultServers[0].channels[0].id);

  const setActiveServer = useCallback((id: string) => {
    setActiveServerId(id);
    setServers(prev => {
      const srv = prev.find(s => s.id === id);
      if (srv && srv.channels.length > 0) {
        const firstText = srv.channels.find(c => c.type === 'text');
        setActiveChannelId(firstText ? firstText.id : srv.channels[0].id);
      }
      return prev;
    });
  }, []);

  const setActiveChannel = useCallback((id: string) => {
    setActiveChannelId(id);
  }, []);

  const createServer = useCallback((name: string, color: string) => {
    const id = uid();
    const channelId = uid();
    const newServer: Server = {
      id,
      name,
      color,
      channels: [
        {
          id: channelId,
          name: 'general',
          type: 'text',
          description: `Welcome to ${name}!`,
          messages: [
            {
              id: uid(),
              author: 'System',
              authorId: 'system',
              content: `Welcome to ${name}! This is the beginning of #general.`,
              date: new Date().toLocaleDateString(),
              isBot: true,
            },
          ],
        },
        {
          id: uid(),
          name: 'General Voice',
          type: 'voice',
          description: '',
          messages: [],
        },
      ],
      bots: [],
      members: [{ id: 'me', username: user.username, discriminator: user.discriminator, avatar: user.avatar, online: true }],
    };
    setServers(prev => [...prev, newServer]);
    setActiveServerId(id);
    setActiveChannelId(channelId);
  }, [user]);

  const createChannel = useCallback((serverId: string, name: string, type: ChannelType, description?: string) => {
    const id = uid();
    setServers(prev => prev.map(s => {
      if (s.id !== serverId) return s;
      return { ...s, channels: [...s.channels, { id, name, type, description: description || '', messages: [] }] };
    }));
    if (type === 'text') setActiveChannelId(id);
  }, []);

  const deleteChannel = useCallback((serverId: string, channelId: string) => {
    setServers(prev => prev.map(s => {
      if (s.id !== serverId) return s;
      const remaining = s.channels.filter(c => c.id !== channelId);
      return { ...s, channels: remaining };
    }));
    setActiveChannelId(prev => {
      if (prev !== channelId) return prev;
      const srv = servers.find(s => s.id === serverId);
      const remaining = (srv?.channels || []).filter(c => c.id !== channelId);
      return remaining[0]?.id || '';
    });
  }, [servers]);

  const addBot = useCallback((serverId: string, botName: string) => {
    const bot: Bot = { id: uid(), name: botName };
    const botMember: Member = { id: bot.id, username: botName, discriminator: '#0000', isBot: true, online: true };
    setServers(prev => prev.map(s => {
      if (s.id !== serverId) return s;
      return { ...s, bots: [...s.bots, bot], members: [...s.members, botMember] };
    }));
  }, []);

  const sendMessage = useCallback((serverId: string, channelId: string, content: string) => {
    if (!content.trim()) return;
    const msg: Message = {
      id: uid(),
      author: user.username,
      authorId: user.id,
      avatar: user.avatar,
      content: content.trim(),
      date: new Date().toLocaleDateString(),
    };
    setServers(prev => prev.map(s => {
      if (s.id !== serverId) return s;
      return {
        ...s,
        channels: s.channels.map(c => {
          if (c.id !== channelId) return c;
          return { ...c, messages: [...c.messages, msg] };
        }),
      };
    }));
  }, [user]);

  const updateUser = useCallback((profile: Partial<UserProfile>) => {
    setUserState(prev => ({ ...prev, ...profile }));
    setServers(prev => prev.map(s => ({
      ...s,
      members: s.members.map(m => m.id === 'me' ? { ...m, username: profile.username || m.username, avatar: profile.avatar || m.avatar } : m),
    })));
  }, []);

  const setUser = useCallback((u: UserProfile) => setUserState(u), []);

  return (
    <AppContext.Provider
      value={{
        user, setUser, servers, activeServerId, activeChannelId,
        setActiveServer, setActiveChannel, createServer, createChannel,
        deleteChannel, addBot, sendMessage, updateUser,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
