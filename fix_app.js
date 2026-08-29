const fs = require('fs');
let content = fs.readFileSync('app.js', 'utf8');
let lines = content.split('\n');
let newLines = lines.map(line => {
    let cleanLine = line.replace(/\\'/g, '');
    let quoteCount = (cleanLine.match(/'/g) || []).length;
    if (quoteCount % 2 !== 0) {
        let match = line.match(/([,;\)\}]+\s*)$/);
        if (match) {
            return line.slice(0, match.index) + "'" + line.slice(match.index);
        } else {
            return line.replace(/\s*$/, '') + "'";
        }
    }
    return line;
});
fs.writeFileSync('app.js', newLines.join('\n'), 'utf8');
