import os
import re

MAPPINGS = {
    "@/services/censusExportService": "@/features/census/services/censusExportService",
    "@/services/censusStorageService": "@/features/census/services/censusStorageService",
    
    "@/services/CudyrScoreUtils": "@/features/cudyr/services/CudyrScoreUtils",
    "@/services/cudyrSummary": "@/features/cudyr/services/cudyrSummary",
    "@/services/cudyrExportService": "@/features/cudyr/services/cudyrExportService",
    "@/services/cudyrStorageService": "@/features/cudyr/services/cudyrStorageService",
    
    "@/services/backup/baseStorageService": "@/features/backup/services/baseStorageService",
    "@/services/backup/censusStorageService": "@/features/census/services/censusStorageService",
    "@/services/backup/cudyrStorageService": "@/features/cudyr/services/cudyrStorageService",
    
    "@/services/admin/attributionService": "@/features/admin/services/attributionService",
    "@/services/admin/errorService": "@/features/admin/services/errorService",
    "@/utils/errorService": "@/features/admin/services/errorService",
    
    "@/services/whatsapp/whatsappService": "@/features/whatsapp/services/whatsappService",
    "@/services/whatsapp/whatsappLinkService": "@/features/whatsapp/services/whatsappLinkService",
    
    # Feature specific hooks
    "@/hooks/useCudyrLogic": "@/features/cudyr/hooks/useCudyrLogic",
    "@/hooks/useCensusLogic": "@/features/census/hooks/useCensusLogic",
    "@/hooks/useWhatsAppQuery": "@/features/whatsapp/hooks/useWhatsAppQuery",
    "@/hooks/useAudit": "@/features/admin/hooks/useAudit",
}

def fix_broken_imports(directory):
    count = 0
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith(('.ts', '.tsx')):
                path = os.path.join(root, file)
                modified = False
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                new_content = content
                
                # Broadly match any @/ import string
                # matches = re.findall(r"(['\"])(@/.*?)(['\"])", content)
                # Use sub to replace
                for old, new in MAPPINGS.items():
                    if old in new_content:
                        # Check if it's a broken import
                        # (This is a simplified check for the script)
                        new_content = new_content.replace(old, new)
                        modified = True
                        print(f"Fixed in {path}: {old} -> {new}")
                
                if modified:
                    with open(path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    count += 1
    return count

fix_broken_imports('src')
print("Repair complete.")
