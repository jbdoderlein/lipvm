import { MonacoEditorLanguageClientWrapper, UserConfig } from "monaco-editor-wrapper/bundle";
import { useWorkerFactory } from "monaco-editor-wrapper/workerFactory";

/**
 * Location information from CST node
 */
type Location = {
    offset: number;
    end: number;
    length: number;
} | undefined;

/**
 * Pen command (up or down)
 */
type MiniLogoPen = {
    name: 'penUp' | 'penDown';
    location: Location;
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
    location: Location;
};

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
    location: Location;
};

/**
 * MiniLogo commands
 */
type MiniLogoCommand = MiniLogoPen | MiniLogoMove | MiniLogoColor;

/**
 * Represents a version number in the execution tree (e.g., "1", "1.1", "1.2", "1.1.1")
 */
type VersionNumber = string;

/**
 * Represents a single execution state in the version tree
 */
interface ExecutionState {
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

// Store multiple execution states with their version numbers
let executionStates: ExecutionState[] = [];
let currentStep = 0;

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
                name: `${id}-language-server-worker`
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

async function main() {
    // setup worker def & styles
    setup();
    
    // setup a new wrapper
    const wrapper = new MonacoEditorLanguageClientWrapper();
    const userConfig = createUserConfig({
        languageId: 'minilogo',
        code: getMainCode(),
        worker: getWorker(),
        monarchGrammar: getMonarchGrammar()
    });
    await wrapper.initAndStart(userConfig, document.getElementById("monaco-editor-root")!);

    // Get the Monaco editor instance
    const editor = wrapper.getEditor();
    if (!editor) {
        throw new Error('Unable to obtain Monaco editor instance!');
    }

    // Store the current decoration
    let currentDecoration: string[] = [];

    // Function to create decoration for a location
    function createDecorationFromLocation(location: Location) {
        if (!location || !editor) return;
        
        const model = editor.getModel();
        if (!model) return;

        // Convert offset to position
        const startPos = model.getPositionAt(location.offset);
        const endPos = model.getPositionAt(location.end);

        // Remove previous decoration
        if (currentDecoration.length > 0) {
            editor.deltaDecorations(currentDecoration, []);
        }

        // Create new decoration
        currentDecoration = editor.deltaDecorations([], [{
            range: {
                startLineNumber: startPos.lineNumber,
                startColumn: startPos.column,
                endLineNumber: endPos.lineNumber,
                endColumn: endPos.column
            },
            options: {
                inlineClassName: 'current-command-highlight',
                className: 'current-command-highlight',
                isWholeLine: false,
                stickiness: 1,
                overviewRuler: {
                    color: 'yellow',
                    position: 4
                },
                minimap: {
                    color: 'yellow',
                    position: 2
                }
            }
        }]);
    }

    const client = wrapper.getLanguageClient();
    if (!client) {
        throw new Error('Unable to obtain language client for the Minilogo!');
    }

    // Get DOM elements
    const stepBackButton = document.getElementById('step-back') as HTMLButtonElement;
    const stepForwardButton = document.getElementById('step-forward') as HTMLButtonElement;
    const freezeButton = document.getElementById('freeze-button') as HTMLButtonElement;
    const slider = document.getElementById('step-slider') as HTMLInputElement;
    const stepLabel = document.getElementById('step-label') as HTMLSpanElement;
    const canvasContainer = document.getElementById('canvas-container') as HTMLDivElement;
    const originalCanvas = document.getElementById('minilogo-canvas') as HTMLCanvasElement;

    if (!stepBackButton || !stepForwardButton || !freezeButton || !slider || !stepLabel || !canvasContainer || !originalCanvas) {
        throw new Error('Unable to find required DOM elements');
    }

    // Function to create a new canvas
    function createCanvas(version: VersionNumber, isActive: boolean): HTMLCanvasElement {
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
        
        canvasContainer.appendChild(wrapper);
        return canvas;
    }

    // Function to update canvas states based on active and visible executions
    function updateCanvasStates() {
        const canvasWrappers = canvasContainer.querySelectorAll('.canvas-wrapper');
        canvasWrappers.forEach((wrapper, index) => {
            if (index < executionStates.length) {
                const state = executionStates[index];
                wrapper.className = `canvas-wrapper ${state.isActive ? 'active' : 'inactive'}`;
                (wrapper as HTMLElement).style.display = state.isVisible ? 'flex' : 'none';
            }
        });
        updateEditorVersionIndicator();
    }

    // Function to update canvas sizes based on count
    function updateCanvasLayout() {
        const canvasSize = 300; // Fixed size for each canvas
        
        executionStates.forEach(state => {
            if (state.isActive) {
                state.canvas.style.width = `${canvasSize}px`;
                state.canvas.style.height = `${canvasSize}px`;
            }
        });
    }

    // Helper functions for version management
    function getNextVersionNumber(parentVersion: VersionNumber | null): VersionNumber {
        if (!parentVersion) {
            // First version is "1"
            return "1";
        }

        // Get all child versions of the parent
        const siblings = executionStates
            .filter(state => state.parentVersion === parentVersion)
            .map(state => state.version);

        if (siblings.length === 0) {
            // First child of parent (e.g., "1.1")
            return `${parentVersion}.1`;
        }

        // Find the highest sibling number and increment
        const lastSibling = siblings
            .map(v => parseInt(v.split('.').pop() || '0'))
            .reduce((max, num) => Math.max(max, num), 0);
        
        return `${parentVersion}.${lastSibling + 1}`;
    }

    // Helper function to get parent version from a version number
    function getParentVersion(version: VersionNumber): VersionNumber | null {
        const parts = version.split('.');
        if (parts.length === 1) return null;
        return parts.slice(0, -1).join('.');
    }

    // Initialize first execution state with original canvas
    const originalWrapper = document.createElement('div');
    originalWrapper.className = 'canvas-wrapper active';
    const originalLabel = document.createElement('div');
    originalLabel.className = 'canvas-label';
    originalLabel.textContent = 'Version 1';
    originalWrapper.appendChild(originalLabel);
    originalCanvas.parentNode?.insertBefore(originalWrapper, originalCanvas);
    originalWrapper.appendChild(originalCanvas);

    // Create editor version indicator
    const editorVersionIndicator = document.createElement('div');
    editorVersionIndicator.id = 'editor-version-indicator';
    document.getElementById('monaco-editor-root')?.appendChild(editorVersionIndicator);

    // Function to update the editor version indicator
    function updateEditorVersionIndicator() {
        // Find the latest active and visible version that is a leaf node
        const currentVersion = executionStates
            .filter(state => state.isActive && state.isVisible)
            .sort((a, b) => b.version.localeCompare(a.version))
            .find(state => !executionStates.some(s => s.parentVersion === state.version))?.version;

        if (currentVersion && editorVersionIndicator) {
            editorVersionIndicator.textContent = `Working on v${currentVersion}`;
        }
    }

    executionStates.push({
        commands: [],
        canvas: originalCanvas,
        context: originalCanvas.getContext('2d')!,
        isFrozen: false,
        code: '',
        isActive: true,
        isVisible: true, // Initially visible
        parentVersion: null,
        version: "1"
    });

    // Handle step backward button click
    stepBackButton.addEventListener('click', async () => {
        if (executionStates.length === 0) return;
        const newStep = Math.max(0, currentStep - 1);
        if (newStep !== currentStep) {
            currentStep = newStep;
            slider.value = currentStep.toString();
            stepLabel.textContent = `Step: ${currentStep}/${executionStates[0].commands.length}`;
            if (!running) {
                running = true;
                try {
                    await Promise.all(executionStates.map(state => 
                        updateMiniLogoCanvas(state.commands.slice(0, currentStep), state.canvas, state.context)
                    ));
                    updateExecutionGraph();
                } catch (e) {
                    console.error(e);
                }
                running = false;
            }
        }
    });

    // Handle step forward button click
    stepForwardButton.addEventListener('click', async () => {
        if (executionStates.length === 0) return;
        const maxStep = executionStates[0].commands.length;
        const newStep = Math.min(maxStep, currentStep + 1);
        if (newStep !== currentStep) {
            currentStep = newStep;
            slider.value = currentStep.toString();
            stepLabel.textContent = `Step: ${currentStep}/${maxStep}`;
            if (!running) {
                running = true;
                try {
                    await Promise.all(executionStates.map(state => 
                        updateMiniLogoCanvas(state.commands.slice(0, currentStep), state.canvas, state.context)
                    ));
                    updateExecutionGraph();
                } catch (e) {
                    console.error(e);
                }
                running = false;
            }
        }
    });

    // Handle freeze button click
    freezeButton.addEventListener('click', () => {
        if (executionStates.length > 0) {
            const lastState = executionStates[executionStates.length - 1];
            if (!lastState.isFrozen) {
                lastState.isFrozen = true;
                // Store current code with the state
                lastState.code = wrapper.getModel()?.getValue() || '';
                
                // Create new canvas for next execution
                const newVersion = getNextVersionNumber(lastState.version);
                const newCanvas = createCanvas(newVersion, true);
                
                // Create new state
                const newState = {
                    commands: [],
                    canvas: newCanvas,
                    context: newCanvas.getContext('2d')!,
                    isFrozen: false,
                    code: '',
                    isActive: true,
                    isVisible: true,
                    parentVersion: lastState.version,
                    version: newVersion
                };
                
                executionStates.push(newState);

                updateCanvasLayout();
                updateExecutionGraph();
                updateCanvasLabels();
                updateEditorVersionIndicator();
            }
        }
    });

    // Handle slider changes
    slider.addEventListener('input', async () => {
        if (executionStates.length === 0) return;
        
        currentStep = parseInt(slider.value);
        stepLabel.textContent = `Step: ${currentStep}/${executionStates[0].commands.length}`;
        if (!running) {
            running = true;
            try {
                // Update all canvases and the execution graph
                await Promise.all(executionStates.map(state => 
                    updateMiniLogoCanvas(state.commands.slice(0, currentStep), state.canvas, state.context)
                ));
                updateExecutionGraph();
            } catch (e) {
                console.error(e);
            }
            running = false;
        }
    });

    let running = false;
    let timeout: NodeJS.Timeout | null = null;
    
    interface DocumentChangeResponse {
        content: string;
    }

    client.onNotification('browser/DocumentChange', (resp: DocumentChangeResponse) => {
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

            // decode & store commands
            let result = JSON.parse(resp.content);
            const newCommands = result.$commands;
            
            // Find the latest active execution state that's a leaf node
            const latestActiveIndex = executionStates.reduce((latest, state, idx) => {
                if (state.isActive && !executionStates.some(s => s.parentVersion === state.version)) {
                    return idx;
                }
                return latest;
            }, -1);
            
            // Update the latest active execution state
            if (latestActiveIndex >= 0) {
                const currentState = executionStates[latestActiveIndex];
                if (!currentState.isFrozen) {
                    currentState.commands = newCommands;
                    currentStep = newCommands.length;
                    
                    // Update slider range to match command count
                    slider.max = newCommands.length.toString();
                    slider.value = currentStep.toString();
                    stepLabel.textContent = `Step: ${currentStep}/${newCommands.length}`;

                    try {
                        // Update all canvases and the execution graph
                        await Promise.all(executionStates.map(state => 
                            updateMiniLogoCanvas(state.commands.slice(0, currentStep), state.canvas, state.context)
                        ));
                        updateExecutionGraph();
                        updateEditorVersionIndicator();
                    } catch (e) {
                        console.error(e);
                    }
                }
            }
            running = false;
        }, 200);
    });

    /**
     * Takes generated MiniLogo commands, and draws on an HTML5 canvas
     */
    function updateMiniLogoCanvas(cmds: MiniLogoCommand[], canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
        // Only update active canvases
        const state = executionStates.find(state => state.canvas === canvas);
        if (!state?.isActive) return Promise.resolve();

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
    
        context.strokeStyle = 'white';
    
        // maintain some state about our drawing context
        let drawing = false;
        let posX = 0;
        let posY = 0;
    
        const doneDrawingPromise = new Promise((resolve) => {
            // use the command list to execute each command with a small delay
            const id = setInterval(() => {
                if (cmds.length == 1 && state.isActive) {
                    const cmd = cmds[0];
                    // Highlight the command in the editor
                    if (cmd.location) {
                        createDecorationFromLocation(cmd.location);
                    }
                }
                if (cmds.length > 0) {
                    const cmd = cmds.shift() as MiniLogoCommand;
                    dispatchCommand(cmd, context);
                } else {
                    // finish existing draw
                    if (drawing) {
                        context.stroke();
                    }
                    clearInterval(id);
                    resolve('');
                }
            }, 1);
        });
    
        // dispatches a single command in the current context
        function dispatchCommand(cmd: MiniLogoCommand, context: CanvasRenderingContext2D) {
            if (cmd.name) {
                switch (cmd.name) {
                    // pen is lifted off the canvas
                    case 'penUp':
                        drawing = false;
                        context.stroke();
                        break;
    
                    // pen is put down onto the canvas
                    case 'penDown':
                        drawing = true;
                        context.beginPath();
                        context.moveTo(posX, posY);
                        break;
    
                    // move across the canvas
                    // will draw only if the pen is 'down'
                    case 'move':
                        const x = cmd.args.x;
                        const y = cmd.args.y;
                        posX += x;
                        posY += y;
                        if (!drawing) {
                            // move, no draw
                            context.moveTo(posX, posY);
                        } else {
                            // move & draw
                            context.lineTo(posX, posY);
                        }
                        break;
    
                    // set the color of the stroke
                    case 'color':
                        if ((cmd.args as { color: string }).color) {
                            // literal color or hex
                            context.strokeStyle = (cmd.args  as { color: string }).color;
                        } else {
                            // literal r,g,b components
                            const args = cmd.args as { r: number, g: number, b: number };
                            context.strokeStyle = `rgb(${args.r},${args.g},${args.b})`;
                        }
                        break;

                    // fallback in case we missed an instruction
                    default:
                        throw new Error('Unrecognized command received: ' + JSON.stringify(cmd));
    
                }
            }
        }
        return doneDrawingPromise;
    }

    // Function to create a command node element
    function createCommandNode(cmd: MiniLogoCommand, index: number): HTMLElement {
        const node = document.createElement('div');
        node.className = `command-node ${cmd.name.toLowerCase()}`;
        
        let label = '';
        switch (cmd.name) {
            case 'move':
                label = `Move(${cmd.args.x},${cmd.args.y})`;
                break;
            case 'penUp':
                label = 'Pen ↑';
                break;
            case 'penDown':
                label = 'Pen ↓';
                break;
            case 'color':
                const args = cmd.args as any;
                label = args.color ? `Color(${args.color})` : `Color(RGB)`;
                break;
        }
        node.textContent = label;
        
        // Add click handler to highlight the corresponding code and update execution
        node.addEventListener('click', async () => {
            // Highlight code
            if (cmd.location) {
                createDecorationFromLocation(cmd.location);
            }
            
            // Update execution to this step
            if (!running) {
                running = true;
                try {
                    currentStep = index + 1;
                    slider.value = currentStep.toString();
                    stepLabel.textContent = `Step: ${currentStep}/${executionStates[0].commands.length}`;
                    
                    await Promise.all(executionStates.map(state => 
                        updateMiniLogoCanvas(state.commands.slice(0, currentStep), state.canvas, state.context)
                    ));
                    updateExecutionGraph();
                } catch (e) {
                    console.error(e);
                }
                running = false;
            }
        });

        return node;
    }

    // Function to restore a previous execution state
    async function restoreExecution(stateIndex: number) {
        if (stateIndex >= executionStates.length) return;

        // Get the state to restore
        const stateToRestore = executionStates[stateIndex];
        if (!stateToRestore.isFrozen) return;

        // Update the editor content
        const model = wrapper.getModel();
        if (!model) return;
        model.setValue(stateToRestore.code);

        // Mark states as active/inactive based on the restored version
        executionStates.forEach((state) => {
            // A state is active if it's in the path from root to the restored state
            let current: VersionNumber | null = state.version;
            let isInPath = false;
            while (current) {
                if (current === stateToRestore.version) {
                    isInPath = true;
                    break;
                }
                current = getParentVersion(current);
            }
            state.isActive = isInPath;
        });

        // Create new canvas for next execution if needed
        const newVersion = getNextVersionNumber(stateToRestore.version);
        const newCanvas = createCanvas(newVersion, true);
        
        executionStates.push({
            commands: [],
            canvas: newCanvas,
            context: newCanvas.getContext('2d')!,
            isFrozen: false,
            code: '',
            isActive: true,
            isVisible: true, // New executions are visible by default
            parentVersion: stateToRestore.version,
            version: newVersion
        });

        // Update all UI elements
        updateCanvasStates();
        updateCanvasLayout();
        updateExecutionGraph();
        updateCanvasLabels();
        updateEditorVersionIndicator();
    }

    // Function to update the execution graph
    function updateExecutionGraph() {
        const graphContainer = document.querySelector('.execution-timeline');
        if (!graphContainer) return;

        // Clear existing content
        graphContainer.innerHTML = '';

        // Sort states by version number to ensure proper tree display
        const sortedStates = [...executionStates].sort((a, b) => {
            const aDepth = a.version.split('.').length;
            const bDepth = b.version.split('.').length;
            if (aDepth !== bDepth) return aDepth - bDepth;
            return a.version.localeCompare(b.version);
        });

        // Calculate indentation for each state
        const baseIndent = 30; // pixels per level
        sortedStates.forEach(state => {
            const depth = state.version.split('.').length - 1;
            state.treeIndent = depth * baseIndent;
        });

        // Create a row for each execution state
        sortedStates.forEach((state) => {
            const row = document.createElement('div');
            row.className = `execution-row ${state.isActive ? '' : 'inactive'}`;
            row.style.setProperty('--tree-indent', `${state.treeIndent}px`);
            
            // Add current indicator
            const isCurrentVersion = state.isActive && 
                !executionStates.some(s => s.parentVersion === state.version) && 
                !executionStates.some(s => s.isActive && s.version > state.version);
            
            if (isCurrentVersion) {
                row.classList.add('current');
            }
            
            // Add execution label container
            const labelContainer = document.createElement('div');
            labelContainer.className = 'execution-label';
            
            // Add visibility checkbox
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'visibility-checkbox';
            checkbox.checked = state.isVisible;
            checkbox.title = 'Toggle execution visibility';
            checkbox.addEventListener('change', () => {
                state.isVisible = checkbox.checked;
                updateCanvasStates();
            });
            labelContainer.appendChild(checkbox);
            
            const label = document.createElement('span');
            label.textContent = `v${state.version}${isCurrentVersion ? ' (current)' : ''}`;
            labelContainer.appendChild(label);

            // Add change button for all frozen states except the current leaf
            if (state.isFrozen && (!state.isActive || executionStates.some(s => s.parentVersion === state.version))) {
                const changeButton = document.createElement('button');
                changeButton.className = 'change-button';
                changeButton.title = 'Change to this version';
                changeButton.textContent = 'Change';
                changeButton.onclick = () => restoreExecution(executionStates.indexOf(state));
                labelContainer.appendChild(changeButton);
            }

            row.appendChild(labelContainer);

            // Create container for command nodes
            const commandsContainer = document.createElement('div');
            commandsContainer.className = 'commands-container';

            // Add each command as a node
            state.commands.forEach((cmd, cmdIndex) => {
                const node = createCommandNode(cmd, cmdIndex);
                
                // Add tooltip with full command info
                node.textContent = `${node.textContent}`; // Keep existing label
                node.title = node.textContent || '';
                
                // Highlight active command
                const hasChildren = executionStates.some(s => s.parentVersion === state.version);
                if (cmdIndex === currentStep - 1 && state.isActive && !hasChildren) {
                    node.classList.add('active');
                }

                // Mark common commands between executions
                if (state.parentVersion) { // Only compare with parent version
                    const parentState = executionStates.find(s => s.version === state.parentVersion);
                    if (parentState && cmdIndex < parentState.commands.length) {
                        const parentCmd = parentState.commands[cmdIndex];
                        // Compare commands ignoring location info
                        const cmdWithoutLocation = { ...cmd, location: undefined };
                        const parentCmdWithoutLocation = { ...parentCmd, location: undefined };
                        if (JSON.stringify(cmdWithoutLocation) === JSON.stringify(parentCmdWithoutLocation)) {
                            node.classList.add('common');
                        }
                    }
                }

                commandsContainer.appendChild(node);
            });

            row.appendChild(commandsContainer);
            graphContainer.appendChild(row); // Add the row to the graph container
        });
    }

    // Update canvas labels to show version numbers
    function updateCanvasLabels() {
        const canvasWrappers = canvasContainer.querySelectorAll('.canvas-wrapper');
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
}

main();
