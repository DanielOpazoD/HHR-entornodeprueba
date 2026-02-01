import os
import re

def check_imports(directory):
    # Aliases to check
    # @/ -> src/
    
    import_pattern = re.compile(r"from (['\"])(@/.*?)(['\"])")
    import_pattern2 = re.compile(r"import\((['\"])(@/.*?)(['\"])")
    
    broken = []
    
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith(('.ts', '.tsx')):
                path = os.path.join(root, file)
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    matches = import_pattern.findall(content) + import_pattern2.findall(content)
                    for _, imp, _ in matches:
                        # Convert @/path to src/path
                        rel_path = imp.replace('@/', 'src/')
                        
                        # Check as file or index
                        possible_paths = [
                            rel_path + '.ts',
                            rel_path + '.tsx',
                            rel_path + '/index.ts',
                            rel_path + '/index.tsx',
                            rel_path + '.d.ts'
                        ]
                        
                        exists = False
                        for p in possible_paths:
                            if os.path.exists(p):
                                exists = True
                                break
                        
                        if not exists:
                            broken.append((path, imp))
                except Exception as e:
                    print(f"Error reading {path}: {e}")
    
    return broken

broken_imports = check_imports('src')
for file, imp in broken_imports:
    print(f"BROKEN: {file} -> {imp}")
