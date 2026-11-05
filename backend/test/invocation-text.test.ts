import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { prepareInvocationText, channelContextLine } from '../src/agents/invoker.js';
import type { ChannelDoc, MessageDoc, AgentDoc } from '../src/db/types.js';

const userMsg: MessageDoc = {
  _id: new ObjectId(),
  channelId: new ObjectId(),
  serverId: new ObjectId(),
  authorType: 'user',
  authorId: new ObjectId(),
  content: 'find me AI papers',
  mentions: [],
  replyToId: null,
  createdAt: new Date(),
  editedAt: null,
};

const agentMsg: MessageDoc = { ...userMsg, _id: new ObjectId(), authorType: 'agent', content: '@critic please look' };

const targetAgent: AgentDoc = {
  _id: new ObjectId(),
  name: 'Critic', slug: 'critic', avatarUrl: null, description: 'critiques', bio: null, tags: [],
  baseUrl: 'http://x', visibility: 'public', createdBy: new ObjectId(),
  createdAt: new Date(), updatedAt: new Date(),
};

const channel: ChannelDoc = {
  _id: new ObjectId(),
  serverId: new ObjectId(),
  name: 'research',
  topic: null,
  type: 'text',
  defaultAgentId: null,
  position: 0,
  createdAt: new Date(),
};

const peerSlugs = ['researcher', 'critic', 'summarizer'];

describe('prepareInvocationText', () => {
  it('prepends a context line that contains channel name and peer slugs', () => {
    const out = prepareInvocationText({ parent: userMsg, target: targetAgent, channel, peerSlugs, speakerLabel: '@alice' });
    expect(out).toContain('#research');
    expect(out).toContain('@researcher');
    expect(out).toContain('@critic');
    expect(out).toContain('find me AI papers');
    expect(out.startsWith('[')).toBe(true);
  });

  it('annotates agent-authored messages with the speaker label', () => {
    const out = prepareInvocationText({ parent: agentMsg, target: targetAgent, channel, peerSlugs, speakerLabel: '@researcher' });
    expect(out).toContain('@researcher');
    expect(out).toContain('@critic please look');
  });

  it('excludes the target agent from the peer list it sees', () => {
    const out = prepareInvocationText({ parent: agentMsg, target: targetAgent, channel, peerSlugs, speakerLabel: '@researcher' });
    // The context line should list peers OTHER than the target — but the body still contains "@critic please look".
    // We assert by parsing just the first line.
    const firstLine = out.split('\n')[0];
    expect(firstLine).not.toMatch(/peers:.*@critic/);
  });
});

describe('channelContextLine', () => {
  it('formats as [@speaker -> @target in #channel | peers: ...]', () => {
    const line = channelContextLine({ channel, target: targetAgent, peerSlugs, speakerLabel: '@alice' });
    expect(line).toMatch(/^\[@alice (→|->) @critic in #research/);
    expect(line).toContain('peers:');
  });

  it('omits the peers segment when no other peers exist', () => {
    const line = channelContextLine({ channel, target: targetAgent, peerSlugs: ['critic'], speakerLabel: '@alice' });
    expect(line).not.toContain('peers:');
  });
});

describe('pipeline hand-offs (Study Pod, FR5)', () => {
  const podPeers = ['study-note-reader', 'study-tutor', 'study-examiner'];
  const tutor: AgentDoc = { ...targetAgent, _id: new ObjectId(), name: 'Tutor', slug: 'study-tutor' };
  const examiner: AgentDoc = { ...targetAgent, _id: new ObjectId(), name: 'Examiner', slug: 'study-examiner' };
  const readerReply: MessageDoc = { ...userMsg, _id: new ObjectId(), authorType: 'agent', content: '# Notes\n...\n@study-tutor\n\n⟦0g:abc⟧' };

  it('tells the tutor to hand off to the examiner on an agent-to-agent turn', () => {
    const out = prepareInvocationText({
      parent: readerReply, target: tutor, channel, peerSlugs: podPeers,
      speakerLabel: '@study-note-reader', speakerIsHuman: false,
    });
    expect(out).toContain('PIPELINE HAND-OFF');
    expect(out).toContain('"@study-examiner"');
    // The hand-off comes after (and overrides) the generic do-not-forward rule.
    expect(out.indexOf('PIPELINE HAND-OFF')).toBeGreaterThan(out.indexOf('DO NOT end your reply'));
    expect(out.endsWith(readerReply.content)).toBe(true);
  });

  it('gives the examiner no hand-off, so the cascade ends', () => {
    const out = prepareInvocationText({
      parent: readerReply, target: examiner, channel, peerSlugs: podPeers,
      speakerLabel: '@study-tutor', speakerIsHuman: false,
    });
    expect(out).not.toContain('PIPELINE HAND-OFF');
  });

  it('skips the hand-off when the next stage is not in the channel', () => {
    const out = prepareInvocationText({
      parent: readerReply, target: tutor, channel, peerSlugs: ['study-note-reader', 'study-tutor'],
      speakerLabel: '@study-note-reader', speakerIsHuman: false,
    });
    expect(out).not.toContain('PIPELINE HAND-OFF');
  });

  it('keeps the upload marker of the original message intact', () => {
    const withUpload: MessageDoc = { ...userMsg, content: '@study-note-reader\n[[upload:0f8fad5b-d9cb-469f-a165-70867728950e]]' };
    const reader: AgentDoc = { ...targetAgent, _id: new ObjectId(), slug: 'study-note-reader' };
    const out = prepareInvocationText({
      parent: withUpload, target: reader, channel, peerSlugs: podPeers,
      speakerLabel: '@alice', speakerIsHuman: true,
    });
    expect(out).toContain('[[upload:0f8fad5b-d9cb-469f-a165-70867728950e]]');
    expect(out).toContain('"@study-tutor"');
  });
});
