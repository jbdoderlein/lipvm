import { MonacoEditorLanguageClientWrapper } from "monaco-editor-wrapper/bundle";
import { setupMonaco, createUserConfig, getMonarchGrammar, getWorker, getMainCode } from './config/monaco.config';
import { CanvasManager } from './canvas/canvas.manager';
import { ExecutionManager } from './state/execution.manager';
import { TimelineManager } from './ui/timeline.manager';
import { ExecutionState } from './types/minilogo.types';

let running = false;
let timeout: NodeJS.Timeout | null = null;

/**
 * Set a status message to display below the update button
 */
function setStatus(msg: string) {
    const elm = document?.getElementById('status-msg');
    if (elm) {
        elm.innerHTML = msg;
    }
}

/**
 * Main application initialization
 */
async function main() {
    // Setup Monaco editor
    setupMonaco();
    
    // Initialize canvas manager
    const canvasManager = new CanvasManager('canvas-container');
    
    // Get the original canvas
    const originalCanvas = document.getElementById('minilogo-canvas') as HTMLCanvasElement;
    if (!originalCanvas) {
        throw new Error('Original canvas not found');
    }

    // Setup a new wrapper
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

    // Initialize execution manager
    const executionManager = new ExecutionManager(canvasManager);

    // Initialize timeline manager
    const timelineManager = new TimelineManager(
        executionManager,
        editor,
        'step-back',
        'step-forward',
        'step-slider',
        'step-label',
        'execution-timeline'
    );

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

    // Add initial execution state
    executionManager.addExecutionState({
        commands: [],
        canvas: originalCanvas,
        context: originalCanvas.getContext('2d')!,
        isFrozen: false,
        code: '',
        isActive: true,
        isVisible: true,
        parentVersion: null,
        version: "1"
    });

    // Setup freeze button
    const freezeButton = document.getElementById('freeze-button') as HTMLButtonElement;
    if (freezeButton) {
        freezeButton.addEventListener('click', () => {
            const states = executionManager.getExecutionStates();
            if (states.length > 0) {
                const lastState = states[states.length - 1];
                if (!lastState.isFrozen) {
                    lastState.isFrozen = true;
                    lastState.code = wrapper.getModel()?.getValue() || '';
                    
                    // Create new canvas for next execution
                    const newVersion = executionManager.getNextVersionNumber(lastState.version);
                    const newCanvas = canvasManager.createCanvas(newVersion, true, originalCanvas);
                    
                    // Create new state
                    const newState: ExecutionState = {
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
                    
                    executionManager.addExecutionState(newState);
                    timelineManager.updateUI();
                }
            }
        });
    }

    // Handle document changes from the language server
    const client = wrapper.getLanguageClient();
    if (!client) {
        throw new Error('Unable to obtain language client for the Minilogo!');
    }

    interface DocumentChangeResponse {
        content: string;
    }

    client.onNotification('browser/DocumentChange', (resp: DocumentChangeResponse) => {
        // Store program in local storage
        const value = wrapper.getModel()?.getValue();
        if (window.localStorage && value) {
            window.localStorage.setItem('mainCode', value);
        }

        // Block until we're finished with a given run
        if (running) {
            return;
        }
        
        // Clear previous timeouts
        if (timeout) {
            clearTimeout(timeout);
        }

        // Set a timeout to run the current code
        timeout = setTimeout(async () => {
            running = true;
            setStatus('');

            // Decode & store commands
            let result = JSON.parse(resp.content);
            const newCommands = result.$commands;
            
            // Find the latest active execution state that's a leaf node
            const states = executionManager.getExecutionStates();
            const latestActiveIndex = states.reduce((latest: number, state: ExecutionState, idx: number) => {
                if (state.isActive && !states.some((s: ExecutionState) => s.parentVersion === state.version)) {
                    return idx;
                }
                return latest;
            }, -1);
            
            // Update the latest active execution state
            if (latestActiveIndex >= 0) {
                const currentState = states[latestActiveIndex];
                if (!currentState.isFrozen) {
                    currentState.commands = newCommands;
                    await executionManager.setCurrentStep(newCommands.length);
                    timelineManager.updateUI();
                }
            }
            running = false;
        }, 200);
    });
}

main();
