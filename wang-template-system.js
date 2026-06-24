(function () {
  const DEFAULT_COLOR_SETS = {
    2: ['#4fc3f7', '#ffd54f'],
    3: ['#4fc3f7', '#ffd54f', '#81c784'],
    4: ['#4fc3f7', '#ffd54f', '#81c784', '#ff8a65']
  };

  const TEMPLATE_LIBRARY = [
    { id: 'edge-2', name: '2-Edge Wang', type: 'edge', colorCount: 2, slotCount: 4 },
    { id: 'corner-2', name: '2-Corner Wang', type: 'corner', colorCount: 2, slotCount: 4 },
    { id: 'edge-3', name: '3-Edge Wang', type: 'edge', colorCount: 3, slotCount: 4 },
    { id: 'corner-3', name: '3-Corner Wang', type: 'corner', colorCount: 3, slotCount: 4 }
  ];

  function cloneWangId(wangid) {
    return Array.isArray(wangid) ? wangid.slice(0, 8) : [0, 0, 0, 0, 0, 0, 0, 0];
  }

  function wangIdKey(wangid) {
    return cloneWangId(wangid).join(',');
  }

  function getTemplateDefinition(templateId) {
    return TEMPLATE_LIBRARY.find((item) => item.id === templateId) || TEMPLATE_LIBRARY[0];
  }

  function makeDefaultColors(colorCount) {
    const palette = DEFAULT_COLOR_SETS[colorCount] || DEFAULT_COLOR_SETS[4];
    const colors = [{ name: '', color: '#000000', tile: -1 }];
    for (let index = 0; index < colorCount; index++) {
      colors.push({
        name: 'Color ' + (index + 1),
        color: palette[index] || palette[palette.length - 1],
        tile: -1
      });
    }
    return colors;
  }

  function buildWangIdFromSlots(type, slots) {
    const wangid = [0, 0, 0, 0, 0, 0, 0, 0];
    if (type === 'edge') {
      wangid[0] = slots[0];
      wangid[2] = slots[1];
      wangid[4] = slots[2];
      wangid[6] = slots[3];
    } else if (type === 'corner') {
      wangid[7] = slots[0];
      wangid[1] = slots[1];
      wangid[3] = slots[2];
      wangid[5] = slots[3];
    }
    return wangid;
  }

  function enumerateTemplateEntries(templateId) {
    const definition = getTemplateDefinition(templateId);
    const rows = [];
    const total = Math.pow(definition.colorCount, definition.slotCount);

    for (let index = 0; index < total; index++) {
      let remaining = index;
      const slotValues = [];
      for (let slotIndex = 0; slotIndex < definition.slotCount; slotIndex++) {
        slotValues.push((remaining % definition.colorCount) + 1);
        remaining = Math.floor(remaining / definition.colorCount);
      }
      const wangid = buildWangIdFromSlots(definition.type, slotValues);
      rows.push({
        templateIndex: index,
        templateId,
        type: definition.type,
        slotValues,
        wangid,
        key: wangIdKey(wangid),
        label: String(index),
        variants: []
      });
    }

    return rows;
  }

  function createBlock(templateId, name) {
    const definition = getTemplateDefinition(templateId);
    return {
      id: 'wang-block-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
      name: name || definition.name,
      templateId: definition.id,
      type: definition.type,
      tile: -1,
      colors: makeDefaultColors(definition.colorCount),
      tiles: {}
    };
  }

  function getVariantRows(block) {
    const rows = enumerateTemplateEntries(block.templateId);
    const byKey = new Map(rows.map((row) => [row.key, row]));

    Object.entries(block.tiles || {}).forEach(([localIdStr, wangid]) => {
      const localId = parseInt(localIdStr, 10);
      if (!Number.isInteger(localId) || localId < 0) return;
      const row = byKey.get(wangIdKey(wangid));
      if (row) row.variants.push(localId);
    });

    rows.forEach((row) => row.variants.sort((a, b) => a - b));
    return rows;
  }

  function assignVariants(block, wangid, localIds) {
    if (!block || !block.tiles || !Array.isArray(localIds) || localIds.length === 0) return;
    localIds.forEach((localId) => {
      if (!Number.isInteger(localId) || localId < 0) return;
      delete block.tiles[localId];
      block.tiles[localId] = cloneWangId(wangid);
    });
  }

  function removeVariant(block, localId) {
    if (!block || !block.tiles) return;
    delete block.tiles[localId];
  }

  window.wangTemplateSystem = {
    TEMPLATE_LIBRARY,
    getTemplateDefinition,
    enumerateTemplateEntries,
    createBlock,
    getVariantRows,
    assignVariants,
    removeVariant,
    wangIdKey
  };
})();
