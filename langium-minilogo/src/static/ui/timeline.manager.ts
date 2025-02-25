import { MiniLogoCommand, ExecutionState, Location } from '../types/minilogo.types';
import { ExecutionManager } from '../state/execution.manager';

export class TimelineManager {
    private executionManager: ExecutionManager;
    private stepBackButton: HTMLButtonElement;
    private stepForwardButton: HTMLButtonElement;
    private slider: HTMLInputElement;
    private stepLabel: HTMLSpanElement;
    private graphContainer: HTMLElement;
    private editor: any; // Monaco editor instance

    constructor(
        executionManager: ExecutionManager,
        editor: any,
        stepBackButtonId: string,
        stepForwardButtonId: string,
        sliderId: string,
        stepLabelId: string,
        graphContainerId: string
    ) {
        this.executionManager = executionManager;
        this.editor = editor;

        const stepBackBtn = document.getElementById(stepBackButtonId) as HTMLButtonElement;
        const stepForwardBtn = document.getElementById(stepForwardButtonId) as HTMLButtonElement;
        const sliderElement = document.getElementById(sliderId) as HTMLInputElement;
        const stepLabelElement = document.getElementById(stepLabelId) as HTMLSpanElement;
        const graphContainerElement = document.getElementById(graphContainerId);

        if (!stepBackBtn || !stepForwardBtn || !sliderElement || !stepLabelElement || !graphContainerElement) {
            throw new Error('Required UI elements not found');
        }

        this.stepBackButton = stepBackBtn;
        this.stepForwardButton = stepForwardBtn;
        this.slider = sliderElement;
        this.stepLabel = stepLabelElement;
        this.graphContainer = graphContainerElement;

        this.setupEventListeners();
    }

    /**
     * Sets up event listeners for UI controls
     */
    private setupEventListeners() {
        this.stepBackButton.addEventListener('click', async () => {
            const currentStep = this.executionManager.getCurrentStep();
            const newStep = Math.max(0, currentStep - 1);
            if (newStep !== currentStep) {
                await this.executionManager.setCurrentStep(newStep);
                this.updateUI();
            }
        });

        this.stepForwardButton.addEventListener('click', async () => {
            const currentStep = this.executionManager.getCurrentStep();
            const states = this.executionManager.getExecutionStates();
            if (states.length === 0) return;

            const maxStep = states[0].commands.length;
            const newStep = Math.min(maxStep, currentStep + 1);
            if (newStep !== currentStep) {
                await this.executionManager.setCurrentStep(newStep);
                this.updateUI();
            }
        });

        this.slider.addEventListener('input', async () => {
            const newStep = parseInt(this.slider.value);
            await this.executionManager.setCurrentStep(newStep);
            this.updateUI();
        });
    }

    /**
     * Updates the execution graph UI
     */
    updateExecutionGraph() {
        this.graphContainer.innerHTML = '';

        const states = this.executionManager.getExecutionStates();
        const sortedStates = [...states].sort((a, b) => {
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

        sortedStates.forEach((state) => {
            const row = this.createExecutionRow(state);
            this.graphContainer.appendChild(row);
        });
    }

    /**
     * Creates a row in the execution graph for a state
     */
    private createExecutionRow(state: ExecutionState): HTMLElement {
        const row = document.createElement('div');
        row.className = `execution-row ${state.isActive ? '' : 'inactive'}`;
        row.style.setProperty('--tree-indent', `${state.treeIndent}px`);
        
        const isCurrentVersion = this.isCurrentVersion(state);
        if (isCurrentVersion) {
            row.classList.add('current');
        }
        
        const labelContainer = this.createLabelContainer(state, isCurrentVersion);
        row.appendChild(labelContainer);

        const commandsContainer = this.createCommandsContainer(state);
        row.appendChild(commandsContainer);

        return row;
    }

    /**
     * Creates the label container for an execution row
     */
    private createLabelContainer(state: ExecutionState, isCurrentVersion: boolean): HTMLElement {
        const labelContainer = document.createElement('div');
        labelContainer.className = 'execution-label';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'visibility-checkbox';
        checkbox.checked = state.isVisible;
        checkbox.title = 'Toggle execution visibility';
        checkbox.addEventListener('change', () => {
            state.isVisible = checkbox.checked;
            this.executionManager.getExecutionStates().forEach(s => {
                if (s === state) s.isVisible = checkbox.checked;
            });
        });
        labelContainer.appendChild(checkbox);
        
        const label = document.createElement('span');
        label.textContent = `v${state.version}${isCurrentVersion ? ' (current)' : ''}`;
        labelContainer.appendChild(label);

        if (state.isFrozen && (!state.isActive || this.hasChildren(state))) {
            const changeButton = document.createElement('button');
            changeButton.className = 'change-button';
            changeButton.title = 'Change to this version';
            changeButton.textContent = 'Change';
            changeButton.onclick = () => {
                const index = this.executionManager.getExecutionStates().indexOf(state);
                this.executionManager.restoreExecutionState(index);
                this.updateUI();
            };
            labelContainer.appendChild(changeButton);
        }

        return labelContainer;
    }

    /**
     * Creates the commands container for an execution row
     */
    private createCommandsContainer(state: ExecutionState): HTMLElement {
        const commandsContainer = document.createElement('div');
        commandsContainer.className = 'commands-container';

        state.commands.forEach((cmd, cmdIndex) => {
            const node = this.createCommandNode(cmd, cmdIndex, state);
            commandsContainer.appendChild(node);
        });

        return commandsContainer;
    }

    /**
     * Creates a command node element
     */
    private createCommandNode(cmd: MiniLogoCommand, index: number, state: ExecutionState): HTMLElement {
        const node = document.createElement('div');
        node.className = `command-node ${cmd.name.toLowerCase()}`;
        
        node.textContent = this.getCommandLabel(cmd);
        node.title = node.textContent;
        
        const hasChildren = this.hasChildren(state);
        if (index === this.executionManager.getCurrentStep() - 1 && state.isActive && !hasChildren) {
            node.classList.add('active');
        }

        if (state.parentVersion) {
            this.markCommonCommands(cmd, index, state, node);
        }

        node.addEventListener('click', async () => {
            if (cmd.location) {
                this.createDecorationFromLocation(cmd.location);
            }
            
            await this.executionManager.setCurrentStep(index + 1);
            this.updateUI();
        });

        return node;
    }

    /**
     * Gets a human-readable label for a command
     */
    private getCommandLabel(cmd: MiniLogoCommand): string {
        switch (cmd.name) {
            case 'move':
                return `Move(${cmd.args.x},${cmd.args.y})`;
            case 'penUp':
                return 'Pen ↑';
            case 'penDown':
                return 'Pen ↓';
            case 'color':
                const args = cmd.args as any;
                return args.color ? `Color(${args.color})` : `Color(RGB)`;
            default:
                return cmd.name;
        }
    }

    /**
     * Marks commands that are common between parent and child versions
     */
    private markCommonCommands(cmd: MiniLogoCommand, index: number, state: ExecutionState, node: HTMLElement) {
        const states = this.executionManager.getExecutionStates();
        const parentState = states.find(s => s.version === state.parentVersion);
        if (parentState && index < parentState.commands.length) {
            const parentCmd = parentState.commands[index];
            const cmdWithoutLocation = { ...cmd, location: undefined };
            const parentCmdWithoutLocation = { ...parentCmd, location: undefined };
            if (JSON.stringify(cmdWithoutLocation) === JSON.stringify(parentCmdWithoutLocation)) {
                node.classList.add('common');
            }
        }
    }

    /**
     * Checks if a state has any child states
     */
    private hasChildren(state: ExecutionState): boolean {
        return this.executionManager.getExecutionStates().some(s => s.parentVersion === state.version);
    }

    /**
     * Checks if a state is the current version
     */
    private isCurrentVersion(state: ExecutionState): boolean {
        const states = this.executionManager.getExecutionStates();
        return state.isActive && 
            !states.some(s => s.parentVersion === state.version) && 
            !states.some(s => s.isActive && s.version > state.version);
    }

    /**
     * Creates decoration for a location in the editor
     */
    private createDecorationFromLocation(location: Location) {
        if (!location || !this.editor) return;
        
        const model = this.editor.getModel();
        if (!model) return;

        const startPos = model.getPositionAt(location.offset);
        const endPos = model.getPositionAt(location.end);

        // Create new decoration
        this.editor.deltaDecorations([], [{
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

    /**
     * Updates all UI elements
     */
    updateUI() {
        const currentStep = this.executionManager.getCurrentStep();
        const states = this.executionManager.getExecutionStates();
        if (states.length === 0) return;

        const maxStep = states[0].commands.length;
        this.slider.value = currentStep.toString();
        this.stepLabel.textContent = `Step: ${currentStep}/${maxStep}`;
        this.updateExecutionGraph();
    }
} 