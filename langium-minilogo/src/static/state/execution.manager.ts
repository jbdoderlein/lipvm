import { ExecutionState, VersionNumber } from '../types/minilogo.types';
import { CanvasManager } from '../canvas/canvas.manager';

export class ExecutionManager {
    private executionStates: ExecutionState[] = [];
    private currentStep = 0;
    private canvasManager: CanvasManager;

    constructor(canvasManager: CanvasManager) {
        this.canvasManager = canvasManager;
    }

    /**
     * Gets the current step number
     */
    getCurrentStep(): number {
        return this.currentStep;
    }

    /**
     * Gets all execution states
     */
    getExecutionStates(): ExecutionState[] {
        return this.executionStates;
    }

    /**
     * Sets the current step and updates all canvases
     */
    async setCurrentStep(step: number) {
        if (this.executionStates.length === 0) return;
        
        const maxStep = this.executionStates[0].commands.length;
        this.currentStep = Math.max(0, Math.min(step, maxStep));
        
        await Promise.all(this.executionStates.map(state => 
            this.canvasManager.updateMiniLogoCanvas(
                state.commands.slice(0, this.currentStep),
                state.canvas,
                state.context,
                state
            )
        ));
    }

    /**
     * Helper function to get parent version from a version number
     */
    getParentVersion(version: VersionNumber): VersionNumber | null {
        const parts = version.split('.');
        return parts.length === 1 ? null : parts.slice(0, -1).join('.');
    }

    /**
     * Gets the next version number based on the parent version
     */
    getNextVersionNumber(parentVersion: VersionNumber | null): VersionNumber {
        if (!parentVersion) {
            return "1";
        }

        const siblings = this.executionStates
            .filter(state => state.parentVersion === parentVersion)
            .map(state => state.version);

        if (siblings.length === 0) {
            return `${parentVersion}.1`;
        }

        const lastSibling = siblings
            .map(v => parseInt(v.split('.').pop() || '0'))
            .reduce((max, num) => Math.max(max, num), 0);
        
        return `${parentVersion}.${lastSibling + 1}`;
    }

    /**
     * Adds a new execution state
     */
    addExecutionState(state: ExecutionState) {
        this.executionStates.push(state);
        this.canvasManager.updateCanvasStates(this.executionStates);
        this.canvasManager.updateCanvasLayout(this.executionStates);
        this.canvasManager.updateCanvasLabels(this.executionStates);
    }

    /**
     * Restores a previous execution state
     */
    restoreExecutionState(stateIndex: number): ExecutionState | null {
        if (stateIndex >= this.executionStates.length) return null;

        const stateToRestore = this.executionStates[stateIndex];
        if (!stateToRestore.isFrozen) return null;

        // Mark states as active/inactive based on the restored version
        this.executionStates.forEach((state) => {
            let current: VersionNumber | null = state.version;
            let isInPath = false;
            while (current) {
                if (current === stateToRestore.version) {
                    isInPath = true;
                    break;
                }
                current = this.getParentVersion(current);
            }
            state.isActive = isInPath;
        });

        return stateToRestore;
    }
} 