import { MonacoEditorLanguageClientWrapper, UserConfig } from "monaco-editor-wrapper/bundle";
import { useWorkerFactory } from "monaco-editor-wrapper/workerFactory";

/**
 * Pen command (up or down)
 */
type MiniLogoPen = {
    name: 'penUp' | 'penDown'
};

/**
 * Move command
 */
type MiniLogoMove = {
    name: 'move'
    args: {
        x: number;
        y: number;
    }
};

/**
 * Color definition
 */
type HexOrLitColor = {
    color: string
} | {
    r: number
    g: number
    b: number
};

/**
 * Color command
 */
type MiniLogoColor = {
    name: 'color'
    args: HexOrLitColor
};

/**
 * MiniLogo commands
 */
type MiniLogoCommand = MiniLogoPen | MiniLogoMove | MiniLogoColor;

export type WorkerUrl = string;

/**
 * Generalized configuration used with 'getMonacoEditorReactConfig' to generate a working configuration for monaco-editor-react
 */
export interface ClassicConfig {
    code: string,
    languageId: string,
    worker: WorkerUrl | Worker,
    monarchGrammar: any;
}

/**
 * Generates a UserConfig for a given Langium example, which is then passed to the monaco-editor-react component
 * 
 * @param config A VSCode API or classic editor config to generate a UserConfig from
 * @returns A completed UserConfig
 */
export function createUserConfig(config: ClassicConfig): UserConfig {
    // setup urls for config & grammar
    const id = config.languageId;

    // generate langium config
    return {
        wrapperConfig: {
            editorAppConfig: {
                $type: 'classic',
                languageId: id,
                useDiffEditor: false,
                code: config.code,
                theme: 'vs-dark',
                languageDef: config.monarchGrammar
            },
            serviceConfig: {
                debugLogging: false
            }
        },
        languageClientConfig: {
            options: {
                $type: 'WorkerDirect',
                worker: config.worker as Worker,
                name: id
            }
        }
    };
}

/**
 * Prepare to setup the wrapper, building the worker def & setting up styles
 */
function setup() {
    const workerUrl = new URL('monaco-editor-wrapper/dist/workers/editorWorker-es.js', window.location.href).href;
    useWorkerFactory({
        ignoreMapping: true,
        workerLoaders: {
            editorWorkerService: () => new Worker(workerUrl, { type: 'module' })
        }
    });
}

/**
 * Returns a Monarch grammar definition for MiniLogo
 */
function getMonarchGrammar() {
    return {
        keywords: [
            'color','def','down','for','move','pen','to','up'
        ],
        operators: [
            '-',',','*','/','+','='
        ],
        symbols:  /-|,|\(|\)|\{|\}|\*|\/|\+|=/,
    
        tokenizer: {
            initial: [
                { regex: /#(\d|[a-fA-F]){3,6}/, action: {"token":"string"} },
                { regex: /[_a-zA-Z][\w_]*/, action: { cases: { '@keywords': {"token":"keyword"}, '@default': {"token":"string"} }} },
                { regex: /(?:(?:-?[0-9]+)?\.[0-9]+)|-?[0-9]+/, action: {"token":"number"} },
                { include: '@whitespace' },
                { regex: /@symbols/, action: { cases: { '@operators': {"token":"operator"}, '@default': {"token":""} }} },
            ],
            whitespace: [
                { regex: /\s+/, action: {"token":"white"} },
                { regex: /\/\*/, action: {"token":"comment","next":"@comment"} },
                { regex: /\/\/[^\n\r]*/, action: {"token":"comment"} },
            ],
            comment: [
                { regex: /[^\/\*]+/, action: {"token":"comment"} },
                { regex: /\*\//, action: {"token":"comment","next":"@pop"} },
                { regex: /[\/\*]/, action: {"token":"comment"} },
            ],
        }
    };
}

/**
 * Retrieves the program code to display, either a default or from local storage
 */
function getMainCode() {
    let mainCode = `
    def test() {
        move(100, 0)
        pen(down)
        move(100, 100)
        move(-100, 100)
        move(-100, -100)
        move(100, -100)
        pen(up)
    }
    color(white)
    test()
    
    `;
    
    // seek to restore any previous code from our last session
    if (window.localStorage) {
        const storedCode = window.localStorage.getItem('mainCode');
        if (storedCode !== null) {
            mainCode = storedCode;
        }
    }

    return mainCode;
}

/**
 * Creates & returns a fresh worker using the Minilogo language server
 */
function getWorker() {
    const workerURL = new URL('minilogo-server-worker.js', window.location.href);
    return new Worker(workerURL.href, {
        type: 'module',
        name: 'MiniLogoLS'
    });
}

/**
 * Set a status message to display below the update button
 * @param msg Status message to display
 */
function setStatus(msg: string) {
    const elm = document?.getElementById('status-msg');
    if (elm) {
        elm.innerHTML = msg;
    }
}

// Store the last received commands from the worker
let storedCommands: MiniLogoCommand[] = [];
// Current position in the command list when stepping
let currentCommandIndex = 0;
// Canvas state
let canvasState = {
    drawing: false,
    posX: 0,
    posY: 0,
    strokeStyle: 'white'
};

async function main() {
    // setup worker def & styles
    setup();
    
    // setup a new wrapper
    // keep a reference to a promise for when the editor is finished starting, we'll use this to setup the canvas on load
    const wrapper = new MonacoEditorLanguageClientWrapper();
    const userConfig = createUserConfig({
        languageId: 'minilogo',
        code: getMainCode(),
        worker: getWorker(),
        monarchGrammar: getMonarchGrammar()
    })
    await wrapper.initAndStart(userConfig, document.getElementById("monaco-editor-root")!);

    const client = wrapper.getLanguageClient();
    if (!client) {
        throw new Error('Unable to obtain language client for the Minilogo!');
    }

    let running = false;
    let timeout: NodeJS.Timeout | null = null;
    
    // Get button elements
    const executeBtn = document.getElementById('execute-btn') as HTMLButtonElement;
    const stepBtn = document.getElementById('step-btn') as HTMLButtonElement;
    const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
    
    // Initialize canvas
    const canvas = document.getElementById('minilogo-canvas') as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Unable to get canvas context!');
    }
    
    // Draw initial grid
    drawGrid(canvas, context);
    
    // Add event listeners for buttons
    executeBtn.addEventListener('click', () => {
        if (storedCommands.length > 0) {
            prepareForExecution();
        } else {
            setStatus('No program to execute. Edit the code first.');
        }
    });
    
    stepBtn.addEventListener('click', () => {
        if (currentCommandIndex < storedCommands.length) {
            stepThroughCommand(storedCommands[currentCommandIndex], context);
            currentCommandIndex++;
            
            if (currentCommandIndex >= storedCommands.length) {
                stepBtn.disabled = true;
                setStatus('Program execution completed');
            }
        }
    });
    
    clearBtn.addEventListener('click', () => {
        clearCanvas(canvas, context);
        currentCommandIndex = 0;
        stepBtn.disabled = storedCommands.length === 0;
        canvasState = {
            drawing: false,
            posX: 0,
            posY: 0,
            strokeStyle: 'white'
        };
    });

    client.onNotification('browser/DocumentChange', (resp) => {
        // always store this new program in local storage
        const value = wrapper.getModel()?.getValue();
        if (window.localStorage && value) {
            window.localStorage.setItem('mainCode', value);
        }

        // block until we're finished with a given run
        if (running) {
            return;
        }
        
        // clear previous timeouts
        if (timeout) {
            clearTimeout(timeout);
        }

        // set a timeout to run the current code
        timeout = setTimeout(async () => {
            running = true;
            setStatus('');
            console.info('parsing current code...');

            // decode & store commands
            let result = JSON.parse(resp.content);
            storedCommands = result.$commands;
            
            // Reset command index but don't enable step button yet
            // User needs to click Execute first
            currentCommandIndex = 0;
            stepBtn.disabled = true;
            
            setStatus('Program parsed. Click Execute to prepare for execution.');
            running = false;
        }, 200);
    });
    
    /**
     * Draws a grid on the canvas
     */
    function drawGrid(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        
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
    }
    
    /**
     * Clears the canvas and redraws the grid
     */
    function clearCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
        drawGrid(canvas, context);
        setStatus('Canvas cleared');
    }
    
    /**
     * Executes a single command and updates the canvas state
     */
    function stepThroughCommand(cmd: MiniLogoCommand, context: CanvasRenderingContext2D) {
        if (cmd.name) {
            switch (cmd.name) {
                // pen is lifted off the canvas
                case 'penUp':
                    canvasState.drawing = false;
                    context.stroke();
                    setStatus('Command: Pen Up');
                    break;

                // pen is put down onto the canvas
                case 'penDown':
                    canvasState.drawing = true;
                    context.beginPath();
                    context.moveTo(canvasState.posX, canvasState.posY);
                    setStatus('Command: Pen Down');
                    break;

                // move across the canvas
                // will draw only if the pen is 'down'
                case 'move':
                    const x = cmd.args.x;
                    const y = cmd.args.y;
                    canvasState.posX += x;
                    canvasState.posY += y;
                    if (!canvasState.drawing) {
                        // move, no draw
                        context.moveTo(canvasState.posX, canvasState.posY);
                    } else {
                        // move & draw
                        context.lineTo(canvasState.posX, canvasState.posY);
                        context.stroke();
                        context.beginPath();
                        context.moveTo(canvasState.posX, canvasState.posY);
                    }
                    setStatus(`Command: Move (${x}, ${y})`);
                    break;

                // set the color of the stroke
                case 'color':
                    if ((cmd.args as { color: string }).color) {
                        // literal color or hex
                        canvasState.strokeStyle = (cmd.args as { color: string }).color;
                    } else {
                        // literal r,g,b components
                        const args = cmd.args as { r: number, g: number, b: number };
                        canvasState.strokeStyle = `rgb(${args.r},${args.g},${args.b})`;
                    }
                    context.strokeStyle = canvasState.strokeStyle;
                    setStatus(`Command: Set Color to ${canvasState.strokeStyle}`);
                    break;

                // fallback in case we missed an instruction
                default:
                    throw new Error('Unrecognized command received: ' + JSON.stringify(cmd));
            }
        }
    }
    
    /**
     * Prepares the program for step-by-step execution
     */
    function prepareForExecution() {
        // Reset command index and enable step button
        currentCommandIndex = 0;
        stepBtn.disabled = false;
        
        // Reset canvas state but don't clear the canvas
        canvasState = {
            drawing: false,
            posX: 0,
            posY: 0,
            strokeStyle: 'white'
        };
        
        if (context) {
            context.strokeStyle = canvasState.strokeStyle;
        }
        
        setStatus('Program ready. Click Step to execute commands one by one.');
    }
}

main();
