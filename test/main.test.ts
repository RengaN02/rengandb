import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import Database from '../src/main';

const TEMP_DIR = path.join(__dirname, '__temp_tests__');
const JSON_FILE = path.join(TEMP_DIR, 'test_db.json');
const YAML_FILE = path.join(TEMP_DIR, 'test_db.yaml');
const INVALID_FILE = path.join(TEMP_DIR, 'test_db.txt');

// Helper function to close watchers left open during the test process
async function closeDbWatcher(db: Database<any>) {
    if (db && db.watcher) {
        await db.filesystem.stopWatcher(db.watcher);
    }
}

describe('Rengandb (Database Class)', () => {
    
    // Create a temporary directory before tests start
    beforeEach(async () => {
        try {
            await fs.mkdir(TEMP_DIR, { recursive: true });
        } catch {}
    });

    // Clean up temporary test files after each test
    afterEach(async () => {
        try {
            await fs.rm(TEMP_DIR, { recursive: true, force: true });
        } catch {}
    });

    describe('Initialization and File Types', () => {
        it('Should throw an error for unsupported file extensions', () => {
            expect(() => new Database(INVALID_FILE)).toThrow('Unsupported file type!');
        });

        it('Should successfully initialize a JSON database and create a default empty object', async () => {
            const db = await Database.init(JSON_FILE);
            expect(db.initialized).toBe(true);
            expect(db.fetchAll()).toEqual({});
            await closeDbWatcher(db);
        });

        it('Should successfully initialize a YAML database', async () => {
            const db = await Database.init(YAML_FILE);
            expect(db.initialized).toBe(true);
            expect(db.fileType).toBe('.yaml');
            await closeDbWatcher(db);
        });
    });

    describe('Native Engine Basic CRUD Operations', () => {
        let db: Database<boolean>;

        beforeEach(async () => {
            db = await Database.init(JSON_FILE);
        });

        afterEach(async () => {
            await closeDbWatcher(db);
        });

        it('Should be able to write (set) and read (get/fetch) data', async () => {
            await db.set('user', 'John');
            expect(db.get('user')).toBe('John');
            expect(db.fetch('user')).toBe('John');
        });

        it('Should return null when searching for a non-existent key', () => {
            expect(db.get('non_existing')).toBeNull();
        });

        it('Should correctly check key existence with the has() method', async () => {
            await db.set('active', true);
            expect(db.has('active')).toBe(true);
            expect(db.has('passive')).toBe(false);
        });

        it('Should be able to delete data', async () => {
            await db.set('temp', 123);
            expect(db.has('temp')).toBe(true);
            
            await db.delete('temp');
            expect(db.has('temp')).toBe(false);
        });

        it('Should throw an error when the key to delete is not found', async () => {
            await expect(db.delete('missing_key')).rejects.toThrow('not found in database.');
        });

        it('fetchAll() should return the entire database object', async () => {
            await db.set('a', 1);
            await db.set('b', 2);
            expect(db.fetchAll()).toEqual({ a: 1, b: 2 });
        });
    });

    describe('File Watcher Synchronization', () => {
        let db1: Database<boolean>;
        let db2: Database<boolean>;

        beforeEach(async () => {
            db1 = await Database.init(JSON_FILE);
            db2 = await Database.init(JSON_FILE);
        });

        afterEach(async () => {
            await closeDbWatcher(db1);
            await closeDbWatcher(db2);
        });

        it('Should synchronize data changes across multiple database instances', async () => {
            await db1.set("score", 100)
            await expect.poll(() => db2.get('score')).toBe(100);
        });

    });

    describe('Mathematical Operations (math)', () => {
        let db: Database<boolean>;

        beforeEach(async () => {
            db = await Database.init(JSON_FILE);
            await db.set('score', 100);
        });

        afterEach(async () => {
            await closeDbWatcher(db);
        });

        it('Should be able to update numeric values (Addition)', async () => {
            await db.math('score', 50, (found, val) => found + val);
            expect(db.get('score')).toBe(150);
        });

        it('Should be able to update numeric values (Subtraction)', async () => {
            await db.math('score', 20, (found, val) => found - val);
            expect(db.get('score')).toBe(80);
        });

        it('Should throw an error when the key is not found', async () => {
            await expect(
                db.math('unknown', 10, (f, v) => f + v)
            ).rejects.toThrow('not found in database.');
        });

        it('Should throw an error when an invalid numeric value is provided', async () => {
            await expect(
                db.math('score', 'invalid' as any, (f, v) => f + v)
            ).rejects.toThrow('Value is not number!');
        });
    });

    describe('Array Operations', () => {
        let db: Database<boolean>;

        beforeEach(async () => {
            db = await Database.init(JSON_FILE);
        });

        afterEach(async () => {
            await closeDbWatcher(db);
        });

        it('Should be able to push elements to a new array', async () => {
            await db.push('items', 'apple');
            await db.push('items', 'banana');
            expect(db.get('items')).toEqual(['apple', 'banana']);
        });

        it('Should return the correct array length', async () => {
            await db.push('list', 1);
            await db.push('list', 2);
            expect(db.length('list')).toBe(2);
        });

        it('Should throw an error when pushing to a non-array type', async () => {
            await db.set('notArray', 'text');
            await expect(db.push('notArray', 'item')).rejects.toThrow('Thats not an array!');
        });

        it('find and findIndex methods should work correctly', async () => {
            await db.push('users', { id: 1, name: 'Alice' });
            await db.push('users', { id: 2, name: 'Bob' });

            const user = db.find('users', (u: any) => u.id === 2);
            const index = db.findIndex('users', (u: any) => u.id === 2);

            expect(user).toEqual({ id: 2, name: 'Bob' });
            expect(index).toBe(1);
        });
    });

    describe('Lodash Engine Support (useLodash: true)', () => {
        let db: Database<boolean>;

        beforeEach(async () => {
            db = await Database.init(JSON_FILE, { useLodash: true });
        });

        afterEach(async () => {
            await closeDbWatcher(db);
        });

        it('Should be able to set and get nested keys', async () => {
            await db.set('user.profile.age', 25);
            expect(db.get('user.profile.age')).toBe(25);
            expect(db.has('user.profile.age')).toBe(true);
        });

        it('Should be able to delete nested keys (unset)', async () => {
            await db.set('a.b.c', 100);
            expect(db.get('a.b.c')).toBe(100);

            await db.delete('a.b.c');
            expect(db.get('a.b.c')).toBeNull();
        });
    });

    describe('Clearing Operations', () => {
        let db: Database<boolean>;

        beforeEach(async () => {
            db = await Database.init(JSON_FILE);
            await db.set('key1', 'val1');
        });

        afterEach(async () => {
            await closeDbWatcher(db);
        });

        it('Should delete all data when clear(true) is called', async () => {
            await db.clear(true);
            expect(db.fetchAll()).toEqual({});
        });

        it('Should not delete data when clear(false) is called', async () => {
            await db.clear(false);
            expect(db.fetchAll()).toEqual({ key1: 'val1' });
        });
    });
});