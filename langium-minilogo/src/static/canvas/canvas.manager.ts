import { MiniLogoCommand, ExecutionState, VersionNumber } from '../types/minilogo.types';

export class CanvasManager {
    private canvasContainer: HTMLElement;

    constructor(containerId: string) {
        const container = document.getElementById(containerId);
        if (!container) {
            throw new Error(`Canvas container with id ${containerId} not found`);
        }
        this.canvasContainer = container;
    }

    /**
     * Creates a new canvas for a given version
     */
    createCanvas(version: VersionNumber, isActive: boolean, originalCanvas: HTMLCanvasElement): HTMLCanvasElement {
        const wrapper = document.createElement('div');
        wrapper.className = `canvas-wrapper ${isActive ? 'active' : 'inactive'}`;
        
        const label = document.createElement('div');
        label.className = 'canvas-label';
        label.textContent = `Version ${version}`;
        wrapper.appendChild(label);
        
        const canvas = document.createElement('canvas');
        canvas.width = originalCanvas.width;
        canvas.height = originalCanvas.height;
        canvas.style.border = '1px solid #333';
        wrapper.appendChild(canvas);
        
        this.canvasContainer.appendChild(wrapper);
        return canvas;
    }

    /**
     * Updates canvas states based on active and visible executions
     */
    updateCanvasStates(executionStates: ExecutionState[]) {
        const canvasWrappers = this.canvasContainer.querySelectorAll('.canvas-wrapper');
        canvasWrappers.forEach((wrapper, index) => {
            if (index < executionStates.length) {
                const state = executionStates[index];
                wrapper.className = `canvas-wrapper ${state.isActive ? 'active' : 'inactive'}`;
                (wrapper as HTMLElement).style.display = state.isVisible ? 'flex' : 'none';
            }
        });
    }

    /**
     * Updates canvas layout based on count
     */
    updateCanvasLayout(executionStates: ExecutionState[]) {
        const canvasSize = 300; // Fixed size for each canvas
        
        executionStates.forEach(state => {
            if (state.isActive) {
                state.canvas.style.width = `${canvasSize}px`;
                state.canvas.style.height = `${canvasSize}px`;
            }
        });
    }

    /**
     * Updates canvas labels to show version numbers
     */
    updateCanvasLabels(executionStates: ExecutionState[]) {
        const canvasWrappers = this.canvasContainer.querySelectorAll('.canvas-wrapper');
        canvasWrappers.forEach((wrapper, index) => {
            if (index < executionStates.length) {
                const state = executionStates[index];
                const label = wrapper.querySelector('.canvas-label');
                if (label) {
                    label.textContent = `Version ${state.version}`;
                }
            }
        });
    }

    /**
     * Takes generated MiniLogo commands, and draws on an HTML5 canvas
     */
    async updateMiniLogoCanvas(cmds: MiniLogoCommand[], canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, state: ExecutionState) {
        if (!state?.isActive) return Promise.resolve();

        context.clearRect(0, 0, canvas.width, canvas.height);
    
        // Draw grid
        context.beginPath();
        context.strokeStyle = '#333';
        for (let x = 0; x <= canvas.width; x+=(canvas.width / 10)) {
            context.moveTo(x, 0);
            context.lineTo(x, canvas.height);
        }
        for (let y = 0; y <= canvas.height; y+=(canvas.height / 10)) {
            context.moveTo(0, y);
            context.lineTo(canvas.width, y);
        }
        context.stroke();
    
        context.strokeStyle = 'white';
    
        // maintain some state about our drawing context
        let drawing = false;
        let posX = 0;
        let posY = 0;
    
        return new Promise<void>((resolve) => {
            // use the command list to execute each command with a small delay
            const id = setInterval(() => {
                if (cmds.length == 0) {
                    // finish existing draw
                    if (drawing) {
                        context.stroke();
                    }
                    clearInterval(id);
                    resolve();
                    return;
                }

                const cmd = cmds.shift() as MiniLogoCommand;
                this.dispatchCommand(cmd, context, drawing, posX, posY);
            }, 1);
        });
    }

    /**
     * Dispatches a single command in the current context
     */
    private dispatchCommand(cmd: MiniLogoCommand, context: CanvasRenderingContext2D, drawing: boolean, posX: number, posY: number) {
        switch (cmd.name) {
            case 'penUp':
                drawing = false;
                context.stroke();
                break;

            case 'penDown':
                drawing = true;
                context.beginPath();
                context.moveTo(posX, posY);
                break;

            case 'move':
                const x = cmd.args.x;
                const y = cmd.args.y;
                posX += x;
                posY += y;
                if (!drawing) {
                    context.moveTo(posX, posY);
                } else {
                    context.lineTo(posX, posY);
                }
                break;

            case 'color':
                if ('color' in cmd.args) {
                    context.strokeStyle = cmd.args.color;
                } else {
                    const { r, g, b } = cmd.args;
                    context.strokeStyle = `rgb(${r},${g},${b})`;
                }
                break;

            default:
                throw new Error('Unrecognized command received: ' + JSON.stringify(cmd));
        }
    }
} 