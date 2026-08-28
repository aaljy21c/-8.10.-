import sys

with open('app.js', 'r', encoding='utf8') as f:
    app_js = f.read()

with open('repl.txt', 'r', encoding='utf8') as f:
    repl = f.read()

start = app_js.find('function renderAudioPreviews(')
end = app_js.find('function handleAudioDictateClick(', start)
if start == -1 or end == -1:
    print('Failed to find boundaries')
    sys.exit(1)

new_app_js = app_js[:start] + repl + '\n  \n  ' + app_js[end:]
with open('app.js', 'w', encoding='utf8') as f:
    f.write(new_app_js)
