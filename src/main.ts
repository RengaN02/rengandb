import fsPromises from 'fs/promises'
import path from 'path';
import YAML from 'yaml';
import chokidar from 'chokidar'
import lockfile from 'proper-lockfile';

const supportedFileTypes = [
    "json",
    "yaml",
    "yml"
]

interface IEngine<KT extends boolean> {
    get<T>(key: KeyType<KT>): T | undefined;
    set<T>(key: KeyType<KT>, value: T): void;
    has(key: KeyType<KT>): boolean;
    delete(key: KeyType<KT>): void;
}

interface IProvider {
    stringify(data: any): any;
    parse(data: any): any;
}

interface IFileSys {
    isExists(path: string): Promise<boolean>;
    writeFile(path: string, data: any): void;
    readFile(path: string): Promise<string>;
    watch(path: string): any;
    stopWatcher(watcher?: any): Promise<void>;
}

type KeyType<KT extends boolean> = KT extends true ? string | Array<string | number | symbol> : string;

interface IDatabaseSettings<KT extends boolean> {
    useLodash?: KT;
    customFileSystem?: IFileSys;
}

class Database<KT extends boolean> {
    file: string;
    fileType: string;
    initialized: boolean;
    settings: IDatabaseSettings<KT>;
    engine: IEngine<KT>;
    provider: IProvider;
    filesystem: IFileSys;
    watcher: any;
    data: any
    private writeQueue: Promise<void>;
    private isWriting: boolean;
    private lodash: any;

    constructor(file: string, settings: IDatabaseSettings<KT> = {}) {
        this.initialized = false;
        this.file = file;
        this.fileType = path.extname(file).toLowerCase();

        if (!supportedFileTypes.includes(this.fileType.replace(/^\./, ''))) {
            this.initialized = false;
            throw this.error("Unsupported file type!");
        }

        this.settings = { 
            useLodash: false as KT,
            customFileSystem: undefined,
            ...settings 
        };
        this.engine = this._native()
        this.provider = this._json()
        this.filesystem = this.settings.customFileSystem || this._fs()
        this.watcher = null
        this.writeQueue = Promise.resolve(); 
        this.isWriting = false;
    }

    static async init(...parameters: ConstructorParameters<typeof Database>) {
        const instance = new Database(...parameters)
        await instance.setup()
        instance.initialized = true;
        instance.data = await instance.loadData()
        await instance.startWatcher();
        return instance;

    }   
    
    
    // Engines (is it lodash or not)

    _lodash(): IEngine<KT> {
        return {
            get: (key: KeyType<KT>) => this.lodash.get(this.data, key),
            set: (key: KeyType<KT>, value: any) => this.lodash.set(this.data, key, value),
            has: (key: KeyType<KT>) => this.lodash.has(this.data, key),
            delete: (key: KeyType<KT>) => this.lodash.unset(this.data, key)
        };
    }

    _native(): IEngine<KT> {
        const normalizeKey = (k: KeyType<KT>): string => {
            return Array.isArray(k) ? k.join(".") : String(k);
        };

        return {
            get: (key: KeyType<KT>) => this.data[normalizeKey(key)],
            set: (key: KeyType<KT>, value: any) => { this.data[normalizeKey(key)] = value; },
            has: (key: KeyType<KT>) => (normalizeKey(key) in this.data),
            delete: (key: KeyType<KT>) => { delete this.data[normalizeKey(key)]; }
        };
    }


    // File Types

    _json(): IProvider {
        return {
            stringify: (data: any) => JSON.stringify(data, null, 4),
            parse: (data: any) => JSON.parse(data)
        };
    }

    _yaml(): IProvider {
        return {
            stringify: (data: any) => YAML.stringify(data, null, { indent: 4 }),
            parse: (data: any) => YAML.parse(data)
        };
    }

    // File Systems

    _fs(): IFileSys {
        return {
            isExists: async (path: string) => {
                try { await fsPromises.access(path); return true; } 
                catch { return false; }
            },
            writeFile: (path: string, data: any) => fsPromises.writeFile(path, data),
            readFile: (path: string) => fsPromises.readFile(path, 'utf8'),
            watch: (path: string) => { 
                const watcher = chokidar.watch(path, {
                    ignoreInitial: true,
                    awaitWriteFinish: {
                        stabilityThreshold: 100,
                        pollInterval: 50
                    },
                })
                watcher
                .on('change', (path) => {
                    if(!this.isWriting) {
                        this.loadData().then(data => { this.data = data; }).catch(err => { console.error(this.error("Watcher cannot read file")) });
                    }
                })
                .on('unlink', (path) => {
                    this.loadData().then(data => { this.data = data; }).catch(err => { console.error(this.error("Watcher cannot read file")) });
                })
                return watcher
            },
            stopWatcher: async(watcher?: any) => {if(watcher) {await watcher.close()}}
        }
    }


    async setup() {
        if (this.settings.useLodash) {
            try {
                const [getModule, setModule, hasModule, unsetModule] = await Promise.all([
                    // @ts-ignore
                    import('lodash/get.js'),
                    // @ts-ignore
                    import('lodash/set.js'),
                    // @ts-ignore
                    import('lodash/has.js'),
                    // @ts-ignore
                    import('lodash/unset.js')
                ]);

                this.lodash = {
                    get: getModule.default || getModule,
                    set: setModule.default || setModule,
                    has: hasModule.default || hasModule,
                    unset: unsetModule.default || unsetModule
                };
                this.engine = this._lodash();
            } catch (err: any) {
                console.error(this.error(`Lodash cannot be loaded: ${err}`));
                this.engine = this._native();
            }
        }
        if(this.fileType === '.yaml' || this.fileType === '.yml') {
            this.provider = this._yaml()
        } else if(this.fileType === '.json') {
            this.provider = this._json()
        }
        return true;
    }

    async startWatcher() {
        if (this.watcher) {
            await this.filesystem.stopWatcher(this.watcher);
        }
        
        this.watcher = await this.filesystem.watch(this.file)
    }

    async loadData() {
        if(!this.initialized) throw this.error("Not initialized");
        try {
            if(!await this.filesystem.isExists(this.file)) {
                await this.filesystem.writeFile(this.file, this.provider.stringify({}))
                return {};
            }
            return this.provider.parse(await this.filesystem.readFile(this.file)) || {}
        } catch {
            return {};
        }
    }

    async write() {
        if(!this.initialized) throw this.error("Not initialized");

        const thetask = this.writeQueue.then(async () => {
            this.isWriting = true;
            let releaseLock: (() => Promise<void>) | undefined;

            try {
                releaseLock = await lockfile.lock(this.file, {
                    retries: { retries: 10, minTimeout: 50 },
                    stale: 5000, 
                });
                const content = this.provider.stringify(this.data);
                await this.filesystem.writeFile(this.file, content);
                await new Promise(resolve => setTimeout(resolve, 150));
                
            } catch (err: any) {
                throw err
            } finally {
                this.isWriting = false;
                if (typeof releaseLock === 'function') {
                    await releaseLock();
                }
            }
        })

        this.writeQueue = thetask.catch(() => {});

        try {
            await thetask; 
        } catch (err: any) {
            throw this.error(`Writing Error: ${err.message}`);
        }

    }

    error(message: string) {
        return new Error(`Saver.db error: ${message}`);
    }

    async set(key: KeyType<KT>, value: any): Promise<void> {
        if(!key) throw this.error(`Undefined key! - ${key}`);
        if(value === undefined) throw this.error(`Undefined value! - ${value}`);
        
        this.engine.set(key, value)
        await this.write();

    }

    async delete(key: KeyType<KT>): Promise<void> {
        if(!key) throw this.error(`Undefined key! - ${key}`);
        if(!this.engine.has(key)) throw this.error(`${key} not found in database.`);
        
        this.engine.delete(key)
        await this.write();
    }

    async math(key: KeyType<KT>, value: any, func: (found: number, value: number) => number): Promise<void> {
        if(!key) throw this.error(`Undefined key! - ${key}`);
        if(value === undefined) throw this.error(`Undefined value! - ${value}`);
        if(!func) throw this.error(`Undefined func!`);  
        
        if(!this.engine.has(key)) throw this.error(`${key} not found in database.`);
        const found: any = this.engine.get(key);
        const numValue = Number(value);
        if(Number.isNaN(numValue)) throw this.error('Value is not number!');
        if(isNaN(found)) throw this.error('Found data is not number!');
        
        this.engine.set(key, func(found, numValue))
        await this.write();
    }

    async push(key: KeyType<KT>, value: any): Promise<void> {
        if(!key) throw this.error(`Undefined key! - ${key}`);
        if(value === undefined) throw this.error(`Undefined value! - ${value}`);
        
        let found: any[] | undefined = this.engine.get(key);
    
        if(found === undefined) {
            found = [];
        } else if(!Array.isArray(found)) {
            throw this.error(`Thats not an array! - ${key}`);
        }
    
        found.push(value);
        this.engine.set(key, found)
        await this.write();
    }

    async clear(really: boolean): Promise<void> {
        if(really) {
            this.data = {};
            await this.write();
        }
    }

    length(key: KeyType<KT>): number | undefined {
        const found = this.engine.get(key);
        if(found === undefined) {
            return undefined;
        } else if(!Array.isArray(found)) {
            throw this.error('Thats not an array!');
        }
        return found.length;
    }

    has(key: KeyType<KT>): boolean {
        if(!key) throw this.error(`Undefined key! - ${key}`);
        return this.engine.has(key);
    }

    fetch(key: KeyType<KT>): any {
        if(!key) throw this.error(`Undefined key! - ${key}`);
        return this.engine.get(key) ?? null;
    }

    get = this.fetch;

    find(key: KeyType<KT>, condition: any): any {
        if(!key) throw this.error(`Undefined key! - ${key}`);
        let foundArray: any[] | undefined = this.engine.get(key);
    
        if(!Array.isArray(foundArray)) {
            throw this.error(`Thats not an array! - ${key}`);
        }

        let found: any = foundArray.find(condition)
        return found;

    }

    findIndex(key: KeyType<KT>, condition: any): number {
        if(!key) throw this.error(`Undefined key! - ${key}`);
        let foundArray: any[] | undefined = this.engine.get(key);
    
        if(!Array.isArray(foundArray)) {
            throw this.error(`Thats not an array! - ${key}`);
        }

        let found: number = foundArray.findIndex(condition)
        return found;
    }

    fetchAll(): any {
        return this.data;
    }

}

export default Database;