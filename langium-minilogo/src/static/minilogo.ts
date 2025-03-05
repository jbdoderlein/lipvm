import { MonacoEditorLanguageClientWrapper, UserConfig } from "monaco-editor-wrapper/bundle";
import { useWorkerFactory } from "monaco-editor-wrapper/workerFactory";

/**
 * Source location information for a command
 */
type SourceLocation = {
    startLine: number;
    endLine: number;
};

/**
 * Pen command (up or down)
 */
type MiniLogoPen = {
    name: 'penUp' | 'penDown';
    sourceLocation?: SourceLocation;
};

/**
 * Move command
 */
type MiniLogoMove = {
    name: 'move'
    args: {
        x: number;
        y: number;
    };
    sourceLocation?: SourceLocation;
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
    args: HexOrLitColor;
    sourceLocation?: SourceLocation;
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
// Monaco editor instance
let monacoEditor: any = null;
// Current line decorations
let currentLineDecorations: string[] = [];
// Flag to track if we're in the middle of execution
let isExecuting = false;
// Store the latest parsed commands from the editor
let latestParsedCommands: MiniLogoCommand[] = [];
// Store code versions for the timeline
interface CodeVersion {
    code: string;
    commands: MiniLogoCommand[];
    timestamp: number;
    description: string;
}
let codeVersions: CodeVersion[] = [];
let currentVersionIndex = -1;

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

    // Store a reference to the Monaco editor instance
    monacoEditor = wrapper.getEditor();

    const client = wrapper.getLanguageClient();
    if (!client) {
        throw new Error('Unable to obtain language client for the Minilogo!');
    }

    let running = false;
    let timeout: NodeJS.Timeout | null = null;
    
    // Get button elements
    const loadBtn = document.getElementById('load-btn') as HTMLButtonElement;
    const executeBtn = document.getElementById('execute-btn') as HTMLButtonElement;
    const stepBtn = document.getElementById('step-btn') as HTMLButtonElement;
    const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
    
    // Get timeline element
    const timelineEl = document.getElementById('code-timeline') as HTMLDivElement;
    
    // Initialize canvas
    const canvas = document.getElementById('minilogo-canvas') as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Unable to get canvas context!');
    }
    
    // Draw initial grid
    drawGrid(canvas, context);
    
    // Initial code parsing
    setTimeout(() => {
        // Add the initial code version to the timeline once it's parsed
        if (storedCommands.length > 0) {
            addCodeVersion(wrapper.getModel()?.getValue() || '', storedCommands, 'Initial code');
        }
    }, 1000);
    
    // Add event listeners for buttons
    loadBtn.addEventListener('click', () => {
        if (latestParsedCommands.length > 0) {
            // If we're in the middle of execution, try to find the corresponding position
            if (isExecuting) {
                // Get the current source position
                const currentCmdIndex = Math.min(currentCommandIndex, storedCommands.length - 1);
                const currentCmd = storedCommands[currentCmdIndex];
                
                if (currentCmd && currentCmd.sourceLocation) {
                    // Find the closest matching command in the new program
                    const newStartIndex = findClosestCommandBySourcePosition(
                        latestParsedCommands, 
                        currentCmd.sourceLocation
                    );
                    
                    // Update stored commands
                    storedCommands = latestParsedCommands;
                    
                    // Set the execution to continue from the matching position
                    currentCommandIndex = newStartIndex;
                    
                    // Make sure the step button is enabled
                    stepBtn.disabled = false;
                    
                    // Update UI
                    setStatus('New code loaded. Continue stepping from the corresponding position.');
                } else {
                    // No source location available, just restart
                    storedCommands = latestParsedCommands;
                    currentCommandIndex = 0;
                    
                    // Keep execution state active but restart from beginning
                    stepBtn.disabled = false;
                    
                    setStatus('New code loaded but source location not available. Execution reset to beginning.');
                }
            } else {
                // Not executing yet, just store the new commands
                storedCommands = latestParsedCommands;
                currentCommandIndex = 0;
                stepBtn.disabled = true;
                setStatus('New code loaded. Click Execute to prepare for execution.');
            }
            
            // Add the new code version to the timeline
            addCodeVersion(wrapper.getModel()?.getValue() || '', latestParsedCommands, 'Loaded code');
            
            // Reset the new code available indicator
            loadBtn.classList.remove('new-code-available');
        } else {
            setStatus('No code to load. Edit the code first.');
        }
    });
    
    executeBtn.addEventListener('click', () => {
        if (storedCommands.length > 0) {
            isExecuting = true;
            prepareForExecution();
            
            // Add an execution version to the timeline
            addCodeVersion(wrapper.getModel()?.getValue() || '', storedCommands, 'Started execution');
        } else {
            setStatus('No program to execute. Edit the code first.');
        }
    });
    
    stepBtn.addEventListener('click', () => {
        if (currentCommandIndex < storedCommands.length) {
            try {
                stepThroughCommand(storedCommands[currentCommandIndex], context);
                currentCommandIndex++;
                
                if (currentCommandIndex >= storedCommands.length) {
                    stepBtn.disabled = true;
                    isExecuting = false;
                    setStatus('Program execution completed');
                } else {
                    // Make sure the step button stays enabled as long as there are more commands
                    stepBtn.disabled = false;
                }
            } catch (error) {
                console.error('Error executing command:', error);
                setStatus('Error executing command. Check console for details.');
            }
        }
    });
    
    clearBtn.addEventListener('click', () => {
        clearCanvas(canvas, context);
        currentCommandIndex = 0;
        isExecuting = false;
        stepBtn.disabled = storedCommands.length === 0;
        canvasState = {
            drawing: false,
            posX: 0,
            posY: 0,
            strokeStyle: 'white'
        };
        
        // Clear line decorations
        if (monacoEditor) {
            currentLineDecorations = monacoEditor.deltaDecorations(currentLineDecorations, []);
        }
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
            console.info('parsing current code...');

            try {
                // decode & store new commands
                let result = JSON.parse(resp.content);
                latestParsedCommands = result.$commands;
                
                // Highlight the load button to indicate new code is available
                loadBtn.classList.add('new-code-available');
                
                setStatus('New code parsed. Click Load to use it for execution.');
            } catch (error) {
                console.error('Error processing new program:', error);
                setStatus('Error processing new program. Check console for details.');
            } finally {
                running = false;
            }
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
        // Highlight the current line in the editor if source location is available
        if (cmd.sourceLocation && monacoEditor) {
            // Clear previous decorations
            currentLineDecorations = monacoEditor.deltaDecorations(currentLineDecorations, []);
            
            // Add new decoration for current line
            const startLine = cmd.sourceLocation.startLine;
            const endLine = cmd.sourceLocation.endLine;
            
            // Create a range using the editor's model
            const model = monacoEditor.getModel();
            if (model) {
                currentLineDecorations = monacoEditor.deltaDecorations([], [
                    {
                        range: {
                            startLineNumber: startLine,
                            startColumn: 1,
                            endLineNumber: endLine,
                            endColumn: 1
                        },
                        options: {
                            isWholeLine: true,
                            className: 'currentExecutionLine',
                            stickiness: 1 // NeverGrowsWhenTypingAtEdges
                        }
                    }
                ]);
                
                // Scroll to the line
                monacoEditor.revealLineInCenter(startLine);
            }
        }
        
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
        stepBtn.disabled = storedCommands.length === 0;
        
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
        
        // Clear any existing line decorations
        if (monacoEditor) {
            currentLineDecorations = monacoEditor.deltaDecorations(currentLineDecorations, []);
        }
        
        // Set execution state
        isExecuting = storedCommands.length > 0;
        
        if (isExecuting) {
            setStatus('Program ready. Click Step to execute commands one by one.');
        } else {
            setStatus('No commands to execute.');
        }
    }

    /**
     * Helper function to find the closest matching command by source position
     */
    function findClosestCommandBySourcePosition(commands: MiniLogoCommand[], sourcePos: SourceLocation): number {
        // Try to find an exact match first
        for (let i = 0; i < commands.length; i++) {
            const cmdSourceLoc = commands[i].sourceLocation;
            if (cmdSourceLoc && cmdSourceLoc.startLine === sourcePos.startLine) {
                return i;
            }
        }
        
        // If no exact match, find the closest command after the current position
        for (let i = 0; i < commands.length; i++) {
            const cmdSourceLoc = commands[i].sourceLocation;
            if (cmdSourceLoc && cmdSourceLoc.startLine >= sourcePos.startLine) {
                return i;
            }
        }
        
        // If no match found, start from the beginning
        return 0;
    }

    /**
     * Adds a new code version to the timeline
     */
    function addCodeVersion(code: string, commands: MiniLogoCommand[], description: string) {
        // Create a new code version
        const newVersion: CodeVersion = {
            code,
            commands: [...commands],
            timestamp: Date.now(),
            description
        };
        
        // Add to the versions array
        codeVersions.push(newVersion);
        currentVersionIndex = codeVersions.length - 1;
        
        // Update the timeline UI
        updateTimelineUI();
    }
    
    /**
     * Updates the timeline UI with the current code versions
     */
    function updateTimelineUI() {
        // Clear the timeline
        timelineEl.innerHTML = '';
        
        // Add nodes for each version
        codeVersions.forEach((version, index) => {
            const node = document.createElement('div');
            node.className = 'timeline-node';
            if (index === currentVersionIndex) {
                node.classList.add('active');
            }
            node.textContent = (index + 1).toString();
            
            // Add tooltip with description and timestamp
            const tooltip = document.createElement('div');
            tooltip.className = 'timeline-tooltip';
            const date = new Date(version.timestamp);
            tooltip.textContent = `${version.description} - ${date.toLocaleTimeString()}`;
            node.appendChild(tooltip);
            
            // Add click handler to load this version
            node.addEventListener('click', () => {
                loadCodeVersion(index);
            });
            
            // Add connections for related versions
            if (index > 0) {
                const connection = document.createElement('div');
                connection.className = 'timeline-connection';
                // Position will be set by CSS
                node.appendChild(connection);
            }
            
            timelineEl.appendChild(node);
        });
    }
    
    /**
     * Loads a specific code version from the timeline
     */
    function loadCodeVersion(versionIndex: number) {
        if (versionIndex >= 0 && versionIndex < codeVersions.length) {
            const version = codeVersions[versionIndex];
            
            // Update the editor content
            if (monacoEditor) {
                monacoEditor.setValue(version.code);
            }
            
            // Update the stored commands
            storedCommands = [...version.commands];
            currentCommandIndex = 0;
            
            // Update the current version index
            currentVersionIndex = versionIndex;
            
            // Update the timeline UI
            updateTimelineUI();
            
            // Update status
            setStatus(`Loaded code version ${versionIndex + 1}: ${version.description}`);
            
            // Reset execution state
            isExecuting = false;
            stepBtn.disabled = true;
        }
    }
}

main();
