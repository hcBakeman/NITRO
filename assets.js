import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

class AssetManager {
  constructor() {
    this.manager = new THREE.LoadingManager();
    this.gltfLoader = new GLTFLoader(this.manager);
    this.cache = {};
    
    this.manager.onStart = (url, itemsLoaded, itemsTotal) => {
      console.log('Started loading file: ' + url + '.\nLoaded ' + itemsLoaded + ' of ' + itemsTotal + ' files.');
    };

    this.manager.onLoad = () => {
      console.log('Loading complete!');
    };

    this.manager.onProgress = (url, itemsLoaded, itemsTotal) => {
      const progress = (itemsLoaded / itemsTotal) * 100;
      if (this._onProgress) this._onProgress(progress);
    };

    this.manager.onError = (url) => {
      console.error('There was an error loading ' + url);
    };

    this._onProgress = null;
  }

  setOnProgress(cb) {
    this._onProgress = cb;
  }

  async loadModel(url) {
    if (this.cache[url]) return this.cache[url];

    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          this.cache[url] = gltf;
          resolve(gltf);
        },
        undefined,
        reject
      );
    });
  }
}

export const Assets = new AssetManager();
