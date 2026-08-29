import re

with open('app.js', 'r', encoding='utf-8', errors='replace') as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    # Count single quotes
    # But wait, there might be escaped quotes \'
    # Let's just use a simple heuristic:
    # If a line has an odd number of single quotes (ignoring escaped ones), it's probably missing a closing quote.
    # We can try to append it before the trailing punctuation (;, ), }, ,)
    
    clean_line = re.sub(r"\\'", "", line)
    if clean_line.count(\"'\") % 2 != 0:
        # It's an unclosed string on this line!
        # Find the last punctuation: ;, ), }, or , before the newline
        m = re.search(r'([,;\)\}]+\s*)$', line)
        if m:
            # insert a quote before the punctuation
            line = line[:m.start()] + \"'\" + line[m.start():]
        else:
            # just append a quote
            line = line.rstrip() + \"'\n\"
    new_lines.append(line)

with open('app.js', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
