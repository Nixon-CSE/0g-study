import React, { useEffect } from 'react';
import styled from 'styled-components';

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const Box = styled.div`
  background: var(--primary);
  border-radius: 8px;
  padding: 24px;
  width: 440px;
  max-width: 95vw;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const Title = styled.h2`
  color: var(--white);
  font-size: 20px;
  font-weight: 700;
`;

const Subtitle = styled.p`
  color: var(--gray);
  font-size: 14px;
`;

const Label = styled.label`
  color: var(--gray);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  display: block;
  margin-bottom: 6px;
`;

const StyledInput = styled.input`
  width: 100%;
  background: var(--quaternary);
  color: var(--white);
  border-radius: 4px;
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid transparent;
  &:focus {
    border-color: var(--discord);
  }
`;

const ColorRow = styled.div`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
`;

const ColorSwatch = styled.button<{ color: string; selected: boolean }>`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: ${({ color }) => color};
  cursor: pointer;
  border: 3px solid ${({ selected }) => (selected ? '#fff' : 'transparent')};
  transition: transform 0.1s;
  &:hover { transform: scale(1.15); }
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
`;

const CancelBtn = styled.button`
  background: transparent;
  color: var(--white);
  padding: 10px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  &:hover { text-decoration: underline; }
`;

const ConfirmBtn = styled.button`
  background: var(--discord);
  color: var(--white);
  padding: 10px 20px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  &:hover { opacity: 0.9; }
  &:disabled { opacity: 0.5; cursor: default; }
`;

export const SERVER_COLORS = ['#cc78a3', '#6633cc', '#4a90e2', '#43b581', '#f9a839', '#f04747', '#83cd29', '#007bcd', '#ed1b24', '#00d8ff'];

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  children: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ title, subtitle, onClose, onConfirm, confirmLabel = 'Create', confirmDisabled, children }) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <Overlay onClick={onClose}>
      <Box onClick={e => e.stopPropagation()}>
        <div>
          <Title>{title}</Title>
          {subtitle && <Subtitle>{subtitle}</Subtitle>}
        </div>
        {children}
        <Actions>
          <CancelBtn onClick={onClose}>Cancel</CancelBtn>
          <ConfirmBtn onClick={onConfirm} disabled={confirmDisabled}>{confirmLabel}</ConfirmBtn>
        </Actions>
      </Box>
    </Overlay>
  );
};

export { Label, StyledInput as Input, ColorRow, ColorSwatch };
export default Modal;
