import { describe, expect, it } from 'vitest';
import { isAllowedExternalUrl } from '../src/main/externalLinks';
import { aboutRows, withSoftwareFlag } from '../src/renderer/app/AboutSection';

// Settings → About shows what build this is and where it is running, and its
// "Report a bug" is the one thing allowed to open something outside the app.

describe('About', () => {
  it('lists the software and system details, release or development', () => {
    const info = {
      name: 'PlutoSim',
      version: '0.1.0',
      platform: 'win32' as const,
      electron: '43.2.0',
      commit: 'ded9531',
      builtAt: '2026-09-17T09:00:00.000Z',
      packaged: true,
      osVersion: '10.0.22631',
      arch: 'x64',
      chrome: '140.0.1',
      node: '22.20.0',
    };
    const rows = Object.fromEntries(aboutRows(info, 'NVIDIA GeForce RTX 3060'));
    expect(rows).toMatchObject({
      Software: 'PlutoSim',
      Version: 'v0.1.0',
      Build: 'ded9531 (release)',
      'Developed by': 'Drona Aviation',
      'Operating system': 'Windows 10.0.22631',
      Graphics: 'NVIDIA GeForce RTX 3060',
      Electron: '43.2.0',
    });
    expect(Object.fromEntries(aboutRows({ ...info, packaged: false }, '')).Build).toBe('ded9531 (development)');
  });

  it('flags a software renderer, and only that', () => {
    const angle = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)';
    expect(withSoftwareFlag(angle)).toMatch(/software, no GPU/);
    expect(withSoftwareFlag('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)')).toMatch(/software/);
    expect(withSoftwareFlag('llvmpipe (LLVM 15.0.7, 256 bits)')).toMatch(/software/);
    expect(withSoftwareFlag('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)')).toBe(
      'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)',
    );
    expect(withSoftwareFlag('Apple M2')).toBe('Apple M2');
  });

  it('only lets the page open the support email', () => {
    expect(isAllowedExternalUrl('mailto:support@plutodrones.com?subject=Bug&body=hi')).toBe(true);
    expect(isAllowedExternalUrl('mailto:SUPPORT@plutodrones.com')).toBe(true);
    expect(isAllowedExternalUrl('mailto:someone@else.com')).toBe(false);
    expect(isAllowedExternalUrl('https://dronaaviation.com')).toBe(false);
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl(42)).toBe(false);
  });
});
