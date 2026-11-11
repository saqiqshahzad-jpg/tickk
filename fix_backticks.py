import sys

filepath = r'c:\tickk backend\tickk-extension\gmail-content-script.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the missing backticks
content = content.replace("modal.innerHTML = \n", "modal.innerHTML = `\n")
content = content.replace("        </div>\n      ;", "        </div>\n      `;")
content = content.replace("            </button>\n          ;", "            </button>\n          `;")
content = content.replace("              <!-- HEADER SECTION -->", "`\n            <!-- HEADER SECTION -->") # Wait, isLoggedIn one might be missing backtick too.
content = content.replace("modal.innerHTML = \n            <!-- HEADER SECTION -->", "modal.innerHTML = `\n            <!-- HEADER SECTION -->")

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed backticks')
