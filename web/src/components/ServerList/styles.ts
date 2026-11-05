import styled from 'styled-components';
import { Add } from 'styled-icons/material';

export const Container = styled.div`
  grid-area: SL;
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: var(--tertiary);
  padding: 11px 0;
  max-height: 100vh;
  overflow-y: scroll;
  ::-webkit-scrollbar { display: none; }
`;

export const ServerBtn = styled.button<{ active?: boolean; bgColor?: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: ${({ active }) => (active ? '16px' : '50%')};
  margin-bottom: 10px;
  cursor: pointer;
  border: none;
  background: ${({ bgColor }) => bgColor || 'var(--primary)'};
  transition: border-radius 0.2s, filter 0.2s;
  > img { width: 30px; height: 30px; }
  > span {
    color: #fff;
    font-size: 18px;
    font-weight: 700;
  }
  &:hover {
    border-radius: 16px;
    filter: brightness(1.15);
  }

  @media (max-width: 598px) {
    width: 35px;
    height: 35px;
  }
`;

export const Separator = styled.div`
  width: 32px;
  border-bottom: 2px solid var(--quaternary);
  margin-bottom: 8px;
`;

export const AddServerBtn = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--primary);
  cursor: pointer;
  border: none;
  margin-bottom: 10px;
  color: #43b581;
  transition: border-radius 0.2s, background 0.2s;
  &:hover {
    border-radius: 16px;
    background: #43b581;
    color: #fff;
  }

  @media (max-width: 598px) {
    width: 35px;
    height: 35px;
  }
`;

export const AddIcon = styled(Add)`
  width: 24px;
  height: 24px;
`;
