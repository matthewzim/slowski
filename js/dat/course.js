/**
 * Course data extractor.
 * Attempts to find and parse structured course/lift/run data from extracted files.
 */

/**
 * Attempt to extract course data from a set of extracted files.
 * Looks for files that might contain lift paths, run definitions, etc.
 * @param {{ path: string, data: ArrayBuffer }[]} files
 * @returns {{ lifts: Object[]|null, runs: Object|null }}
 */
export function extractCourseData(files) {
  const result = { lifts: null, runs: null };

  // Look for course-related files by name
  const courseFiles = files.filter(f => {
    const name = f.path.toLowerCase();
    return name.includes('course') || name.includes('stage') ||
           name.includes('slope') || name.includes('run') ||
           name.includes('lift') || name.includes('path') ||
           name.includes('route') || name.includes('track');
  });

  for (const file of courseFiles) {
    tryParseCourseFile(file, result);
  }

  return result;
}

/**
 * Try to parse a file as course data.
 * Course data in Wii games is often stored as arrays of 3D coordinates.
 */
function tryParseCourseFile(file, result) {
  if (file.data.byteLength < 12) return;

  const view = new DataView(file.data);
  const name = file.path.toLowerCase();

  // Try reading as an array of float triples (common format for paths)
  try {
    const floats = [];
    for (let i = 0; i < file.data.byteLength - 11; i += 12) {
      const x = view.getFloat32(i, false);
      const y = view.getFloat32(i + 4, false);
      const z = view.getFloat32(i + 8, false);

      // Validate: coordinates should be in reasonable range for a game world
      if (isFinite(x) && isFinite(y) && isFinite(z) &&
          Math.abs(x) < 100000 && Math.abs(y) < 100000 && Math.abs(z) < 100000) {
        floats.push([x, y, z]);
      }
    }

    if (floats.length >= 4) {
      // Found a plausible path
      if (name.includes('lift')) {
        if (!result.lifts) result.lifts = [];
        result.lifts.push({
          name: file.path,
          points: floats,
        });
      } else {
        if (!result.runs) result.runs = {};
        result.runs[file.path] = {
          difficulty: 'blue', // default
          points: floats,
        };
      }
    }
  } catch {}
}

/**
 * Convert raw extracted lift points to the game's LIFT_DEFS format.
 * Normalizes 3D coordinates to [0,1] x [0,1] range.
 * @param {Object[]} rawLifts - from extractCourseData
 * @param {THREE.Box3} bounds - world bounds of the terrain
 * @returns {Object[]} - in LIFT_DEFS format
 */
export function convertToLiftDefs(rawLifts, bounds) {
  if (!rawLifts || rawLifts.length === 0) return [];

  const size = {
    x: bounds.max.x - bounds.min.x,
    z: bounds.max.z - bounds.min.z,
  };

  return rawLifts.map((lift, i) => {
    // Sample 4 control points along the path
    const numPoints = lift.points.length;
    const step = Math.max(1, Math.floor(numPoints / 3));
    const controlPoints = [];

    for (let j = 0; j < numPoints; j += step) {
      const p = lift.points[j];
      const nx = (p[0] - bounds.min.x) / size.x;
      const nz = (p[2] - bounds.min.z) / size.z;
      controlPoints.push([nx, nz]);
      if (controlPoints.length >= 4) break;
    }

    // Ensure we have exactly 4 points
    while (controlPoints.length < 4) {
      controlPoints.push(controlPoints[controlPoints.length - 1]);
    }

    return {
      name: lift.name || `Lift ${i + 1}`,
      number: i + 1,
      points: controlPoints.slice(0, 4),
      type: 'chairlift',
      towerSpacing: 400,
      cableHeight: 40,
      color: 0xcc2222,
    };
  });
}
