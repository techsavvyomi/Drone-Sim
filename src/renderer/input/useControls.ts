import { useEffect } from 'react';
import { attachKeyboard } from './controls';

// Mounts keyboard listeners for the lifetime of the flight view.
export function useControls(): void {
  useEffect(() => attachKeyboard(), []);
}
