<?php
/**
 * Firmware publish / query API.
 *
 * Storage layout (all relative to this script):
 *   firmware/meta.json          – version, changeset, fileName, size, publishedAt
 *   firmware/<fileName>         – the raw binary
 *
 * Endpoints:
 *   GET  firmware-api.php               → returns meta.json (or 404)
 *   GET  firmware-api.php?download      → streams the binary (or 404)
 *   POST firmware-api.php               → upload new firmware (multipart: file, version, changeset)
 *   DELETE firmware-api.php             → remove published firmware
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$fwDir = __DIR__ . DIRECTORY_SEPARATOR . 'firmware';
$metaPath = $fwDir . DIRECTORY_SEPARATOR . 'meta.json';

// ── GET ─────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {

    if (!is_file($metaPath)) {
        http_response_code(404);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'no firmware published']);
        exit;
    }

    $meta = json_decode(file_get_contents($metaPath), true);

    // ?download – stream the binary
    if (isset($_GET['download'])) {
        $binPath = $fwDir . DIRECTORY_SEPARATOR . basename($meta['fileName']);
        if (!is_file($binPath)) {
            http_response_code(404);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'firmware file missing']);
            exit;
        }
        header('Content-Type: application/octet-stream');
        header('Content-Length: ' . filesize($binPath));
        header('Content-Disposition: attachment; filename="' . basename($meta['fileName']) . '"');
        readfile($binPath);
        exit;
    }

    // Default: return metadata
    header('Content-Type: application/json');
    echo json_encode($meta);
    exit;
}

// ── POST (publish) ──────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {

    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        http_response_code(400);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'firmware file is required']);
        exit;
    }

    $version = trim($_POST['version'] ?? '');
    $changeset = trim($_POST['changeset'] ?? '');

    if ($version === '') {
        http_response_code(400);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'version is required']);
        exit;
    }
    if ($changeset === '') {
        http_response_code(400);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'changeset is required']);
        exit;
    }

    // Sanitise file name: only keep alphanumeric, dash, underscore, dot
    $safeName = preg_replace('/[^a-zA-Z0-9._-]/', '_', basename($_FILES['file']['name']));
    if ($safeName === '' || $safeName === '.' || $safeName === '..') {
        $safeName = 'firmware.bin';
    }

    if (!is_dir($fwDir)) {
        mkdir($fwDir, 0755, true);
    }

    // Remove old binary if name differs
    if (is_file($metaPath)) {
        $oldMeta = json_decode(file_get_contents($metaPath), true);
        if (!empty($oldMeta['fileName']) && $oldMeta['fileName'] !== $safeName) {
            $oldBin = $fwDir . DIRECTORY_SEPARATOR . basename($oldMeta['fileName']);
            if (is_file($oldBin)) {
                unlink($oldBin);
            }
        }
    }

    $destPath = $fwDir . DIRECTORY_SEPARATOR . $safeName;
    if (!move_uploaded_file($_FILES['file']['tmp_name'], $destPath)) {
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'failed to save firmware file']);
        exit;
    }

    $meta = [
        'version'     => $version,
        'changeset'   => $changeset,
        'fileName'    => $safeName,
        'size'        => filesize($destPath),
        'publishedAt' => round(microtime(true) * 1000),
    ];

    file_put_contents($metaPath, json_encode($meta, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

    header('Content-Type: application/json');
    echo json_encode($meta);
    exit;
}

// ── DELETE ───────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {

    if (is_file($metaPath)) {
        $meta = json_decode(file_get_contents($metaPath), true);
        $binPath = $fwDir . DIRECTORY_SEPARATOR . basename($meta['fileName'] ?? '');
        if (is_file($binPath)) {
            unlink($binPath);
        }
        unlink($metaPath);
    }

    header('Content-Type: application/json');
    echo json_encode(['ok' => true]);
    exit;
}

http_response_code(405);
header('Content-Type: application/json');
echo json_encode(['error' => 'method not allowed']);
