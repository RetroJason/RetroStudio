/**
 * Simple TMX (Tiled Map Exchange) Importer
 * 
 * Purpose: Understand TMX format and validate that it cleanly separates:
 * 1. Tileset metadata (graphics/sprite references)
 * 2. Layer data (which tiles are placed where)
 */

class TMXImporter {
  static parseEditorAnimationMeta(tileEl) {
    const propEls = tileEl.querySelectorAll('properties > property');
    if (!propEls || propEls.length === 0) return null;

    const raw = {};
    propEls.forEach((propEl) => {
      const key = propEl.getAttribute('name');
      if (!key || !key.startsWith('retrowww.anim.')) return;
      const value = propEl.hasAttribute('value') ? propEl.getAttribute('value') : (propEl.textContent || '');
      if (key === 'retrowww.anim.group') raw.groupId = value;
      if (key === 'retrowww.anim.blockW') raw.width = parseInt(value, 10);
      if (key === 'retrowww.anim.blockH') raw.height = parseInt(value, 10);
      if (key === 'retrowww.anim.cell') raw.cellIndex = parseInt(value, 10);
      if (key === 'retrowww.anim.name') raw.name = value;
    });

    const groupId = String(raw.groupId || '').trim();
    const width = parseInt(raw.width, 10);
    const height = parseInt(raw.height, 10);
    const cellIndex = parseInt(raw.cellIndex, 10);
    if (!groupId || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= width * height) return null;

    return {
      groupId,
      width,
      height,
      cellIndex,
      name: String(raw.name || '').trim() || null
    };
  }

  /**
   * Parse TMX XML file content
   * @param {string} xmlContent - Raw XML content of .tmx file
   * @returns {Object} Structured map data
   */
  static parse(xmlContent) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');
    
    if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
      throw new Error('Invalid XML: ' + xmlDoc.getElementsByTagName('parsererror')[0].textContent);
    }
    
    const mapEl = xmlDoc.querySelector('map');
    if (!mapEl) throw new Error('No <map> element found');
    
    return {
      map: this.parseMapElement(mapEl),
      tilesets: this.parseTilesets(mapEl),
      layers: this.parseLayers(mapEl),
      objectGroups: this.parseObjectGroups(mapEl)
    };
  }
  
  /**
   * Parse map element attributes (dimensions, tile size, etc.)
   */
  static parseMapElement(mapEl) {
    return {
      version: mapEl.getAttribute('version'),
      width: parseInt(mapEl.getAttribute('width')),
      height: parseInt(mapEl.getAttribute('height')),
      tileWidth: parseInt(mapEl.getAttribute('tilewidth')),
      tileHeight: parseInt(mapEl.getAttribute('tileheight')),
      orientation: mapEl.getAttribute('orientation') || 'orthogonal',
      renderOrder: mapEl.getAttribute('renderorder') || 'right-down',
      staggerAxis: mapEl.getAttribute('staggeraxis') || 'y',
      staggerIndex: mapEl.getAttribute('staggerindex') || 'odd',
      hexSideLength: parseInt(mapEl.getAttribute('hexsidelength')) || 0
    };
  }
  
  /**
   * IMPORTANT: Parse tileset metadata (graphics references)
   * This is SEPARATE from layer data!
   */
  static parseTilesets(mapEl) {
    const tilesets = [];
    const tilesetEls = mapEl.querySelectorAll('tileset');
    
    tilesetEls.forEach(tsEl => {
      const tileset = {
        firstGid: parseInt(tsEl.getAttribute('firstgid')),
        name: tsEl.getAttribute('name'),
        tileWidth: parseInt(tsEl.getAttribute('tilewidth')),
        tileHeight: parseInt(tsEl.getAttribute('tileheight')),
        tileCount: parseInt(tsEl.getAttribute('tilecount') || 0),
        columns: parseInt(tsEl.getAttribute('columns') || 0),
        spacing: parseInt(tsEl.getAttribute('spacing') || 0),
        margin: parseInt(tsEl.getAttribute('margin') || 0)
      };
      
      // External tileset reference (separate .tsx file)
      const source = tsEl.getAttribute('source');
      if (source) {
        tileset.source = source; // e.g., "terrain.tsx"
      }
      
      // Embedded tileset with <image> element (graphics reference)
      const imageEl = tsEl.querySelector('image');
      if (imageEl) {
        tileset.image = {
          source: imageEl.getAttribute('source'), // e.g., "terrain.png"
          width: parseInt(imageEl.getAttribute('width')),
          height: parseInt(imageEl.getAttribute('height')),
          trans: imageEl.getAttribute('trans') || null
        };

        const tileOffsetEl = tsEl.querySelector('tileoffset');
        if (tileOffsetEl) {
          tileset.tileOffset = {
            x: parseInt(tileOffsetEl.getAttribute('x') || 0),
            y: parseInt(tileOffsetEl.getAttribute('y') || 0)
          };
        }

        // Some TMX files omit columns/tilecount for embedded tilesets.
        if ((!tileset.columns || tileset.columns <= 0) && tileset.tileWidth > 0) {
          const usableWidth = Math.max(0, tileset.image.width - (tileset.margin * 2));
          tileset.columns = Math.floor((usableWidth + tileset.spacing) / (tileset.tileWidth + tileset.spacing));
        }
        if ((!tileset.tileCount || tileset.tileCount <= 0) && tileset.tileHeight > 0 && tileset.columns > 0) {
          const usableHeight = Math.max(0, tileset.image.height - (tileset.margin * 2));
          const rows = Math.floor((usableHeight + tileset.spacing) / (tileset.tileHeight + tileset.spacing));
          tileset.tileCount = rows * tileset.columns;
        }
      }

      const tileEls = tsEl.querySelectorAll('tile');
      tileEls.forEach(tileEl => {
        const tileId = parseInt(tileEl.getAttribute('id'), 10);
        if (Number.isNaN(tileId)) return;

        const editorAnimationMeta = this.parseEditorAnimationMeta(tileEl);
        const animationEl = tileEl.querySelector('animation');
        if (!animationEl && !editorAnimationMeta) return;

        const frames = animationEl ? Array.from(animationEl.querySelectorAll('frame')).map((frameEl) => ({
          tileId: parseInt(frameEl.getAttribute('tileid'), 10),
          duration: Math.max(1, parseInt(frameEl.getAttribute('duration'), 10) || 0)
        })).filter((frame) => Number.isInteger(frame.tileId) && frame.tileId >= 0) : [];

        const tileInfo = {};
        if (frames.length > 0) tileInfo.animation = frames;
        if (editorAnimationMeta) tileInfo.editorAnimationMeta = editorAnimationMeta;
        if (Object.keys(tileInfo).length > 0) {
          tileset.tiles = tileset.tiles || {};
          tileset.tiles[tileId] = tileInfo;
        }
      });

      // Parse Wang sets (terrain auto-tile data).
      // wangid format (Tiled 1.5+): 8 integers [e0, c0, e1, c1, e2, c2, e3, c3]
      // For corner-type sets only corners matter (indices 1,3,5,7 = TR,BR,BL,TL).
      // For edge-type sets only edges matter (indices 0,2,4,6 = T,R,B,L).
      // Color index 0 = "no terrain" / empty.
      const wangsetEls = tsEl.querySelectorAll('wangsets > wangset');
      if (wangsetEls.length > 0) {
        tileset.wangsets = [];
        wangsetEls.forEach(wsEl => {
          const wangset = {
            name: wsEl.getAttribute('name') || 'Terrain',
            type: wsEl.getAttribute('type') || 'corner', // 'corner' | 'edge' | 'mixed'
            tile: parseInt(wsEl.getAttribute('tile') || -1, 10), // representative tile local id
            colors: [],   // [{name, color, tile}]  index 0 = unused (empty)
            tiles: {},    // localTileId -> wangid array [8 ints]
            fromXml: true // Mark as loaded from XML, don't allow UI reassignment
          };

          // wangcolor index starts at 1; index 0 is always "empty"
          wangset.colors.push({ name: '', color: '#000000', tile: -1 }); // slot 0 = empty
          wsEl.querySelectorAll('wangcolor').forEach(wcEl => {
            wangset.colors.push({
              name: wcEl.getAttribute('name') || '',
              color: wcEl.getAttribute('color') || '#888888',
              tile: parseInt(wcEl.getAttribute('tile') || -1, 10)
            });
          });

          wsEl.querySelectorAll('wangtile').forEach(wtEl => {
            const localId = parseInt(wtEl.getAttribute('tileid'), 10);
            const raw = (wtEl.getAttribute('wangid') || '').split(',').map(v => parseInt(v.trim(), 10));
            if (!Number.isNaN(localId) && raw.length === 8) {
              wangset.tiles[localId] = raw;
            }
          });

          tileset.wangsets.push(wangset);
        });
      }

      tilesets.push(tileset);
    });
    
    return tilesets;
  }
  
  /**
   * IMPORTANT: Parse layer data (which tiles are placed where)
   * This is SEPARATE from tileset references!
   */
  static parseLayers(mapEl) {
    const layers = [];
    const layerEls = mapEl.querySelectorAll('layer');
    
    layerEls.forEach(layerEl => {
      const layer = {
        name: layerEl.getAttribute('name'),
        x: parseInt(layerEl.getAttribute('x') || 0),
        y: parseInt(layerEl.getAttribute('y') || 0),
        width: parseInt(layerEl.getAttribute('width')),
        height: parseInt(layerEl.getAttribute('height')),
        opacity: parseFloat(layerEl.getAttribute('opacity') || 1),
        visible: layerEl.getAttribute('visible') !== '0',
        data: []
      };
      
      // Parse tile data (can be CSV, Base64, or XML)
      const dataEl = layerEl.querySelector('data');
      if (dataEl) {
        const encoding = dataEl.getAttribute('encoding');
        const compression = dataEl.getAttribute('compression');
        
        if (encoding === 'csv') {
          layer.data = this.parseCSVData(dataEl.textContent, layer.width * layer.height);
        } else if (encoding === 'base64') {
          layer.data = this.parseBase64Data(dataEl.textContent, layer.width * layer.height, compression);
        } else {
          // XML (uncompressed)
          layer.data = this.parseXMLData(dataEl);
        }
      }
      
      layers.push(layer);
    });
    
    return layers;
  }
  
  /**
   * Parse object groups (spawn points, triggers, etc.)
   */
  static parseObjectGroups(mapEl) {
    const objectGroups = [];
    const groupEls = mapEl.querySelectorAll('objectgroup');
    
    groupEls.forEach(groupEl => {
      const group = {
        name: groupEl.getAttribute('name'),
        color: groupEl.getAttribute('color') || '#ff8800',
        visible: groupEl.getAttribute('visible') !== '0',
        objects: []
      };
      
      const objectEls = groupEl.querySelectorAll('object');
      objectEls.forEach(objEl => {
        group.objects.push({
          id: parseInt(objEl.getAttribute('id')),
          name: objEl.getAttribute('name') || '',
          type: objEl.getAttribute('type') || objEl.getAttribute('class') || '',
          gid: objEl.hasAttribute('gid') ? parseInt(objEl.getAttribute('gid')) : null,
          x: parseFloat(objEl.getAttribute('x')),
          y: parseFloat(objEl.getAttribute('y')),
          width: parseFloat(objEl.getAttribute('width') || 0),
          height: parseFloat(objEl.getAttribute('height') || 0),
          ellipse: !!objEl.querySelector('ellipse'),
          point: !!objEl.querySelector('point')
        });
      });
      
      objectGroups.push(group);
    });
    
    return objectGroups;
  }
  
  static parseCSVData(csvText, count) {
    return csvText
      .trim()
      .split(/[\s,]+/)
      .map(v => parseInt(v))
      .slice(0, count);
  }
  
  static parseBase64Data(base64Text, count, compression) {
    const binaryString = atob(base64Text.trim());
    let bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Handle common TMX compressed payloads via pako when available.
    if (compression === 'zlib' || compression === 'gzip') {
      if (typeof window !== 'undefined' && window.pako) {
        bytes = window.pako.inflate(bytes);
      } else {
        throw new Error(`Base64 layer uses ${compression} compression but pako is not loaded`);
      }
    }

    const data = [];
    for (let i = 0; i < Math.min(bytes.length / 4, count); i++) {
      const tileId =
        (bytes[i * 4]) |
        (bytes[i * 4 + 1] << 8) |
        (bytes[i * 4 + 2] << 16) |
        (bytes[i * 4 + 3] << 24);
      data.push(tileId >>> 0);
    }
    return data;
  }
  
  static parseXMLData(dataEl) {
    const data = [];
    const tileEls = dataEl.querySelectorAll('tile');
    tileEls.forEach(tileEl => {
      data.push(parseInt(tileEl.getAttribute('gid')));
    });
    return data;
  }
  
  /**
   * Pretty print parsed TMX structure
   */
  static printStructure(parsed) {
    console.log('=== MAP STRUCTURE ===');
    console.log('Map:', parsed.map);
    
    console.log('\n=== TILESETS (GRAPHICS REFERENCES) ===');
    parsed.tilesets.forEach(ts => {
      console.log(`Tileset: ${ts.name}`);
      console.log(`  First GID: ${ts.firstGid} (used in layer data to reference this tileset)`);
      if (ts.image) {
        console.log(`  Image: ${ts.image.source} (${ts.image.width}×${ts.image.height}px)`);
      }
      if (ts.source) {
        console.log(`  External: ${ts.source}`);
      }
    });
    
    console.log('\n=== LAYERS (MAP DATA) ===');
    parsed.layers.forEach(layer => {
      console.log(`Layer: "${layer.name}" (${layer.width}×${layer.height} tiles)`);
      console.log(`  Visible: ${layer.visible}, Opacity: ${layer.opacity}`);
      console.log(`  First 10 tiles (GID references): ${layer.data.slice(0, 10).join(', ')}`);
      console.log(`  Total tiles: ${layer.data.length}`);
    });
    
    if (parsed.objectGroups.length > 0) {
      console.log('\n=== OBJECT GROUPS ===');
      parsed.objectGroups.forEach(group => {
        console.log(`Object Group: "${group.name}" (${group.objects.length} objects)`);
        group.objects.forEach(obj => {
          console.log(`  - "${obj.name}" (type: ${obj.type}) @ (${obj.x}, ${obj.y})`);
        });
      });
    }
  }
}

// Export for Node.js or browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TMXImporter;
}
