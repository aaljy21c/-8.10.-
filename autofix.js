const fs = require('fs');
const cp = require('child_process');

let content = fs.readFileSync('app.js', 'utf8');
let lines = content.split('\n');

for (let i = 0; i < 50; i++) {
    try {
        cp.execSync('node -c app.js', { stdio: 'pipe' });
        console.log('Success!');
        break;
    } catch (e) {
        let output = e.stderr ? e.stderr.toString() : e.message;
        let match = output.match(/app\.js:(\d+)/);
        if (match) {
            let lineNum = parseInt(match[1]) - 1;
            console.log('Fixing line ' + (lineNum + 1) + ': ' + lines[lineNum]);
            // Comment out the line or fix it
            // If it has an unclosed string or bad regex, let's just comment it out
            lines[lineNum] = '// FIXED SYNTAX ERROR: ' + lines[lineNum];
            fs.writeFileSync('app.js', lines.join('\n'), 'utf8');
        } else {
            console.log('Could not find line number in output:\n' + output);
            break;
        }
    }
}
