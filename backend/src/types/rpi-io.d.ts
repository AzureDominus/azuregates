// Type declarations for rpi-io
// https://www.npmjs.com/package/rpi-io

declare module 'rpi-io' {
  /**
   * RIO class for GPIO access using libgpiod
   */
  export class RIO {
    /**
     * Create a new GPIO pin instance
     * @param pin BCM pin number (e.g., 17 for GPIO17)
     * @param mode 'output' or 'input'
     * @param options Optional configuration
     */
    constructor(
      pin: number,
      mode: 'output' | 'input',
      options?: {
        /** Initial value for output pins (0 or 1) */
        value?: 0 | 1;
        /** Pull-up/down resistor for input pins */
        pull?: 'up' | 'down' | 'none';
      }
    );

    /**
     * Write a value to an output pin
     * @param value 0 (low) or 1 (high)
     */
    write(value: 0 | 1): void;

    /**
     * Read the current value of an input pin
     * @returns 0 (low) or 1 (high)
     */
    read(): 0 | 1;

    /**
     * Close the GPIO pin and release resources
     */
    close(): void;
  }
}
