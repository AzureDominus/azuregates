// Type declarations for onoff (Raspberry Pi GPIO library)
// This module is optional and only available on Raspberry Pi
declare module 'onoff' {
  export class Gpio {
    constructor(gpio: number, direction: 'in' | 'out' | 'high' | 'low', edge?: string, options?: object);
    read(callback?: (err: Error | null, value: 0 | 1) => void): Promise<0 | 1>;
    readSync(): 0 | 1;
    write(value: 0 | 1, callback?: (err: Error | null) => void): Promise<void>;
    writeSync(value: 0 | 1): void;
    watch(callback: (err: Error | null, value: 0 | 1) => void): void;
    unwatch(callback?: (err: Error | null, value: 0 | 1) => void): void;
    unwatchAll(): void;
    direction(): 'in' | 'out';
    setDirection(direction: 'in' | 'out'): void;
    edge(): string;
    setEdge(edge: string): void;
    activeLow(): boolean;
    setActiveLow(invert: boolean): void;
    unexport(): void;
    static accessible: boolean;
  }
}
