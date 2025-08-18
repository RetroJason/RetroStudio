<?php
// Simple admin page for updating the application
// This is for development/testing purposes only

// Configuration
define('ADMIN_PASSWORD', 'retro2025'); // Change this to your desired password
define('REPO_URL', 'https://github.com/RetroJason/RetroStudio.git'); // Repository URL
define('REPO_PATH', __DIR__); // Current directory (root of the project)
define('GIT_BRANCH', 'main');// Branch to pull from

// Handle API requests for git logs (for changelog service)
if (isset($_GET['api']) && $_GET['api'] === 'changelog') {
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: *'); // Allow CORS for local development
    
    chdir(REPO_PATH);
    
    // Get current commit hash
    $current_commit = '';
    exec('git rev-parse HEAD 2>/dev/null', $current_output);
    if (!empty($current_output[0])) {
        $current_commit = trim($current_output[0]);
    }
    
    // Get commits since a specific commit (if provided)
    $since_commit = $_GET['since'] ?? '';
    $limit = min(50, max(1, intval($_GET['limit'] ?? 10))); // Max 50 commits, default 10
    
    $commits = [];
    
    if ($since_commit && $since_commit !== $current_commit) {
        // Get commits between since_commit and current
        $git_cmd = "git log --oneline --pretty=format:'%H|%an|%ae|%ad|%s' --date=iso {$since_commit}..HEAD 2>/dev/null";
    } else {
        // Get recent commits
        $git_cmd = "git log --oneline --pretty=format:'%H|%an|%ae|%ad|%s' --date=iso -n {$limit} 2>/dev/null";
    }
    
    $git_output = [];
    exec($git_cmd, $git_output);
    
    foreach ($git_output as $line) {
        $parts = explode('|', $line, 5);
        if (count($parts) === 5) {
            $commits[] = [
                'hash' => $parts[0],
                'short_hash' => substr($parts[0], 0, 7),
                'author' => $parts[1],
                'email' => $parts[2],
                'date' => $parts[3],
                'message' => $parts[4]
            ];
        }
    }
    
    $response = [
        'current_commit' => $current_commit,
        'current_short' => substr($current_commit, 0, 7),
        'commits' => $commits,
        'timestamp' => date('c')
    ];
    
    echo json_encode($response, JSON_PRETTY_PRINT);
    exit;
}

// Start session for basic security
session_start();

// Handle logout
if (isset($_GET['logout'])) {
    session_destroy();
    header('Location: admin.php');
    exit;
}

// Handle login
if (isset($_POST['password'])) {
    if ($_POST['password'] === ADMIN_PASSWORD) {
        $_SESSION['admin_logged_in'] = true;
    } else {
        $error = 'Invalid password';
    }
}

// Handle update request
if (isset($_POST['update']) && isset($_SESSION['admin_logged_in'])) {
    $output = [];
    $output_submodules = [];
    $return_code = 0;
    
    // Change to repository directory
    chdir(REPO_PATH);
    
    // Simple git pull operation
    exec('git pull origin ' . GIT_BRANCH . ' 2>&1', $output, $return_code);

    // Initialize and update submodules
    if ($return_code === 0) { // Only proceed if the pull was successful
        exec('git submodule update --init --recursive 2>&1', $output_submodules, $return_code_submodules);
    }
    
    $update_result = [
        'success' => $return_code === 0,
        'output' => implode("\n", array_merge($output, $output_submodules ?? [])),
        'return_code' => $return_code
    ];
}

// Check current git status
$git_status = [];
chdir(REPO_PATH);
exec('git status --porcelain 2>&1', $git_status);
exec('git log -1 --pretty=format:"%h - %an, %ar : %s" 2>/dev/null', $last_commit);
exec('git remote get-url origin 2>/dev/null', $remote_url);

// Check if user is logged in
$is_logged_in = isset($_SESSION['admin_logged_in']) && $_SESSION['admin_logged_in'] === true;
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RetroStudio Admin</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
            color: #333;
        }
        
        .container {
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        h1 {
            color: #2c3e50;
            border-bottom: 2px solid #3498db;
            padding-bottom: 10px;
        }
        
        .login-form {
            max-width: 300px;
            margin: 0 auto;
        }
        
        .form-group {
            margin-bottom: 15px;
        }
        
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        
        input[type="password"] {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }
        
        .btn {
            display: inline-block;
            padding: 10px 20px;
            background-color: #3498db;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            text-decoration: none;
            font-size: 14px;
            margin-right: 10px;
        }
        
        .btn:hover {
            background-color: #2980b9;
        }
        
        .btn-danger {
            background-color: #e74c3c;
        }
        
        .btn-danger:hover {
            background-color: #c0392b;
        }
        
        .btn-success {
            background-color: #27ae60;
        }
        
        .btn-success:hover {
            background-color: #229954;
        }
        
        .alert {
            padding: 15px;
            margin-bottom: 20px;
            border-radius: 4px;
        }
        
        .alert-error {
            background-color: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        .alert-success {
            background-color: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        
        .alert-warning {
            background-color: #fff3cd;
            color: #856404;
            border: 1px solid #ffeaa7;
        }
        
        .output {
            background-color: #2c3e50;
            color: #ecf0f1;
            padding: 15px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            white-space: pre-wrap;
            overflow-x: auto;
            margin-top: 15px;
        }
        
        .header-actions {
            float: right;
        }
        
        .status-info {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 20px;
        }
        
        .status-info h3 {
            margin-top: 0;
            color: #495057;
        }
    </style>
</head>
<body>
    <div class="container">
        <?php if (!$is_logged_in): ?>
            <!-- Login Form -->
            <h1>RetroStudio Admin Login</h1>
            
            <?php if (isset($error)): ?>
                <div class="alert alert-error"><?php echo htmlspecialchars($error); ?></div>
            <?php endif; ?>
            
            <form method="POST" class="login-form">
                <div class="form-group">
                    <label for="password">Admin Password:</label>
                    <input type="password" id="password" name="password" required>
                </div>
                <button type="submit" class="btn">Login</button>
            </form>
            
        <?php else: ?>
            <!-- Admin Dashboard -->
            <div class="header-actions">
                <a href="?logout=1" class="btn btn-danger">Logout</a>
            </div>
            
            <h1>RetroStudio Admin Panel</h1>
            
            <!-- Status Information -->
            <div class="status-info">
                <h3>Repository Information</h3>
                <p><strong>Path:</strong> <?php echo htmlspecialchars(REPO_PATH); ?></p>
                <p><strong>Repository URL:</strong> <?php echo htmlspecialchars(REPO_URL); ?></p>
                <p><strong>Branch:</strong> <?php echo htmlspecialchars(GIT_BRANCH); ?></p>
                
                <p><strong>Status:</strong> <span style="color: #27ae60;">✓ Git repository initialized</span></p>
                <?php if (!empty($remote_url[0])): ?>
                    <p><strong>Remote URL:</strong> <?php echo htmlspecialchars($remote_url[0]); ?></p>
                <?php endif; ?>
                <?php if (!empty($last_commit[0])): ?>
                    <p><strong>Last Commit:</strong> <?php echo htmlspecialchars($last_commit[0]); ?></p>
                <?php endif; ?>
                <?php if (!empty($git_status)): ?>
                    <p><strong>Working Directory:</strong> <span style="color: #e74c3c;">Has uncommitted changes</span></p>
                <?php else: ?>
                    <p><strong>Working Directory:</strong> <span style="color: #27ae60;">Clean</span></p>
                <?php endif; ?>
                
                <p><strong>Current Time:</strong> <?php echo date('Y-m-d H:i:s'); ?></p>
            </div>
            
            <!-- Update Results -->
            <?php if (isset($update_result)): ?>
                <?php if ($update_result['success']): ?>
                    <div class="alert alert-success">
                        <strong>Repository Updated Successfully!</strong> 
                        The latest changes have been pulled from the repository.
                    </div>
                <?php else: ?>
                    <div class="alert alert-error">
                        <strong>Update Failed!</strong>
                        There was an error during the update operation.
                        <br>Exit code: <?php echo $update_result['return_code']; ?>
                    </div>
                <?php endif; ?>
                
                <?php if (!empty($update_result['output'])): ?>
                    <h3>Git Output:</h3>
                    <div class="output"><?php echo htmlspecialchars($update_result['output']); ?></div>
                <?php endif; ?>
            <?php endif; ?>
            
            <!-- Update Form -->
            <form method="POST" onsubmit="return confirm('Are you sure you want to pull the latest changes from the repository?');">
                <h3>Update Repository</h3>
                <p>Click the button below to pull the latest changes from the repository:</p>
                <button type="submit" name="update" class="btn btn-success">Update Repository</button>
            </form>
            
            <!-- Navigation -->
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
                <h3>Quick Links</h3>
                <a href="index.html" class="btn">View Application</a>
                <a href="." class="btn">Browse Files</a>
                <a href="?api=changelog&limit=5" class="btn" target="_blank">Test Changelog API</a>
            </div>
            
            <!-- Changelog Testing -->
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
                <h3>Changelog Testing</h3>
                <p>Use these buttons to test the changelog functionality in the application:</p>
                <button onclick="testChangelog()" class="btn">Test Changelog Modal</button>
                <button onclick="resetVisitTracking()" class="btn">Reset Visit Tracking</button>
                <button onclick="viewCurrentCommit()" class="btn">View Current Commit</button>
            </div>
            
            <script>
            function testChangelog() {
                if (window.parent && window.parent.ChangelogService) {
                    const service = new window.parent.ChangelogService();
                    service.showTestChangelog();
                } else {
                    // Open in new window to test
                    const newWindow = window.open('index.html', '_blank');
                    newWindow.addEventListener('load', () => {
                        setTimeout(() => {
                            if (newWindow.ChangelogService) {
                                const service = new newWindow.ChangelogService();
                                service.showTestChangelog();
                            }
                        }, 2000);
                    });
                }
            }
            
            function resetVisitTracking() {
                document.cookie = 'retrostudio_last_visit=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                document.cookie = 'retrostudio_last_commit=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                alert('Visit tracking reset. Next visit to the application will be treated as first visit.');
            }
            
            function viewCurrentCommit() {
                fetch('./admin.php?api=changelog&limit=1')
                    .then(response => response.json())
                    .then(data => {
                        alert('Current commit: ' + data.current_short + '\nFull hash: ' + data.current_commit);
                    })
                    .catch(error => {
                        alert('Error fetching commit: ' + error.message);
                    });
            }
            </script>
            
        <?php endif; ?>
    </div>
</body>
</html>
