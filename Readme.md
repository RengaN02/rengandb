# rengandb

A **safe**, **performant**, and **file-locking protected** JSON/YAML database module for Node.js. 

Designed to be simple yet robust, `rengandb` prevents data corruption (i think...) during simultaneous writes and automatically syncs data when the file is modified externally.

## Features

* 🔒 **Concurrency Safe:** Uses `proper-lockfile` to queue write operations, preventing data corruption when multiple processes try to write simultaneously.
* 👀 **Live Watcher:** Integrates `chokidar` to monitor your database file. If you edit the JSON/YAML file manually, the RAM is automatically updated.
* 🪶 **Flexible Engine:** Choose between lightweight native object assignment or powerful deep-object manipulation using `lodash`.
* 📁 **Multi-Format:** Supports `.json`, `.yaml`, and `.yml` files out of the box.

---

## Installation

```bash
npm install rengandb
```

---

## Quick Start

```javascript
import Database from 'rengandb';

// Initialize the database (creates database.json if it doesn't exist)
const db = await Database.init('database.json');

// Write data
await db.set('username', 'Rengan');

// Read data
console.log(db.get('username')); // "Rengan"
```

---

## YAML Support

Using YAML instead of JSON is completely seamless. Just change your file extension to `.yaml` or `.yml` when initializing the database. `rengandb` will automatically detect the format and handle the parsing for you.

```javascript
// Initializes a YAML database automatically based on the extension
const db = await Database.init('settings.yml');

await db.set('serverport', 8080);
```

---

## The `useLodash` Engine

`rengandb` comes with two different underlying engines for handling your keys: **Native** (default) and **Lodash**. Understanding the difference is crucial for structuring your data.

### 1. `useLodash: true` (Deep Object Engine)
When enabled, the database uses `lodash` under the hood. This allows you to create heavily nested (deep) objects easily. Array keys and dot-notation will build an object tree.

```javascript
const db = await Database.init('database.json', { useLodash: true });

await db.set(['user', 'age'], 25);
await db.set('user.role', 'admin');

console.log(db.fetchAll());
/*
Output:
{
    "user": {
        "age": 25,
        "role": "admin"
    }
}
*/
```

### 2. `useLodash: false` (Default)
When disabled, the database uses native JavaScript object assignment. This is slightly faster and lighter but treats all keys as flat strings. Array keys are joined by dots, creating a single string key rather than a nested object.

```javascript
const db = await Database.init('database.json', { useLodash: false });

await db.set(['user', 'age'], 25);
await db.set('user.role', 'admin');

console.log(db.fetchAll());
/*
Output:
{
    "user.age": 25,
    "user.role": "admin"
}
*/
```

### ⚠️ WARNING: Do Not Toggle After Saving!
Changing the `useLodash` setting on an **existing** database file will cause structural mismatches and **corrupt your data flow**. 
* If you saved data with `useLodash: true` (nested objects) and later switch to `false`, the database will no longer be able to find your nested keys, as it will look for a flat `"user.age"` string instead of `{ user: { age } }`.
* **Always decide on your engine before pushing to production and stick with it!**

---

## Reference

Once initialized via `await Database.init(file, settings)`, you can use the following methods:

### Core Methods
* **`await db.set(key, value)`**: Saves a value to the specified key.
* **`db.get(key)`** / **`db.fetch(key)`**: Returns the value of the specified key. Returns `null` or `undefined` if not found.
* **`db.has(key)`**: Returns a boolean indicating if the key exists.
* **`await db.delete(key)`**: Deletes the specified key and its value.
* **`db.fetchAll()`**: Returns the entire database object.

### Array & Math Operations
* **`await db.push(key, value)`**: Pushes a value to an array. Creates the array if it doesn't exist.
* **`await db.math(key, value, func)`**: Performs a mathematical operation on an existing number.
  ```javascript
  await db.set('coins', 10);
  await db.math('coins', 5, (first, second) => first + second); 
  console.log(db.get('coins')); // 15
  ```
* **`db.length(key)`**: Returns the length of an array.
* **`db.find(key, condition)`**: Finds an element in an array using a callback function.
  ```javascript
  db.find('users', u => u.id === 123);
  ```
* **`db.findIndex(key, condition)`**: Finds the index of an element in an array.

### Utility
* **`await db.clear(really)`**: Clears the entire database if `true` is passed. (e.g., `await db.clear(true)`).

---

## License

This project is licensed under the MIT License. 
See the [LICENSE](LICENSE) file for details.

> **Note:** This is a hobby project. Please use it responsibly in production environments.