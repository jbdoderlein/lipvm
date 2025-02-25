import { MonacoEditorLanguageClientWrapper, UserConfig } from "monaco-editor-wrapper/bundle";
import { useWorkerFactory } from "monaco-editor-wrapper/workerFactory";

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
 * Returns a Monarch grammar definition for MiniLogo
 */
export function getMonarchGrammar() {
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
 * Generates a UserConfig for a given Langium example, which is then passed to the monaco-editor-react component
 */
export function createUserConfig(config: ClassicConfig): UserConfig {
    const id = config.languageId;

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
export function setupMonaco() {
    const workerUrl = new URL('monaco-editor-wrapper/dist/workers/editorWorker-es.js', window.location.href).href;
    useWorkerFactory({
        ignoreMapping: true,
        workerLoaders: {
            editorWorkerService: () => new Worker(workerUrl, { type: 'module' })
        }
    });
}

/**
 * Creates & returns a fresh worker using the Minilogo language server
 */
export function getWorker() {
    const workerURL = new URL('minilogo-server-worker.js', window.location.href);
    return new Worker(workerURL.href, {
        type: 'module',
        name: 'MiniLogoLS'
    });
}

/**
 * Retrieves the program code to display, either a default or from local storage
 */
export function getMainCode() {
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
    
    if (window.localStorage) {
        const storedCode = window.localStorage.getItem('mainCode');
        if (storedCode !== null) {
            mainCode = storedCode;
        }
    }

    return mainCode;
} 