/**
 * Location information from CST node
 */
export type Location = {
    offset: number;
    end: number;
    length: number;
} | undefined;

/**
 * Pen command (up or down)
 */
export type MiniLogoPen = {
    name: 'penUp' | 'penDown';
    location: Location;
};

/**
 * Move command
 */
export type MiniLogoMove = {
    name: 'move'
    args: {
        x: number;
        y: number;
    }
    location: Location;
};

export type HexOrLitColor = {
    color: string
} | {
    r: number
    g: number
    b: number
};

/**
 * Color command
 */
export type MiniLogoColor = {
    name: 'color'
    args: HexOrLitColor
    location: Location;
};

/**
 * MiniLogo commands
 */
export type MiniLogoCommand = MiniLogoPen | MiniLogoMove | MiniLogoColor;

/**
 * Represents a version number in the execution tree (e.g., "1", "1.1", "1.2", "1.1.1")
 */
export type VersionNumber = string;

/**
 * Represents a single execution state in the version tree
 */
export interface ExecutionState {
    commands: MiniLogoCommand[];
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    isFrozen: boolean;
    code: string;  // Store the code that generated this execution
    isActive: boolean;  // Whether this is the currently active version
    isVisible: boolean; // Whether this execution should be displayed
    parentVersion: VersionNumber | null;  // The version this was derived from
    version: VersionNumber;  // This state's version number
    treeIndent?: number;
} 