import os
import argparse
import sys
from PIL import Image

def split_images_in_folder(folder_path):
    """
    Käib läbi antud kausta pildifailid ja poolitab need vertikaalselt kaheks (vasak/parem).
    Lõikab täpselt 50% pealt.
    Vasak pool saab sufiksi 'a', parem pool 'b'.
    """
    if not os.path.exists(folder_path):
        print(f"VIGA: Kausta ei leitud: {folder_path}")
        return

    valid_extensions = ('.jpg', '.jpeg', '.png')
    files = sorted([f for f in os.listdir(folder_path) if f.lower().endswith(valid_extensions)])
    
    if not files:
        print(f"Hoiatus: Kaustas '{folder_path}' pole sobivaid pildifaile.")
        return

    print(f"Leitud {len(files)} pildifaili. Alustan 'tuima' 50% poolitamist...")
    
    count = 0
    for filename in files:
        file_path = os.path.join(folder_path, filename)
        
        # Jätame vahele juba poolitatud failid (et mitte teha a -> aa, ab)
        if filename.endswith(('a.jpg', 'b.jpg', 'a.png', 'b.png', 'a.jpeg', 'b.jpeg')):
             continue

        try:
            with Image.open(file_path) as img:
                width, height = img.size
                
                # Täpselt 50%
                mid_x = width // 2
                
                # Vasak pool (a)
                crop_a = img.crop((0, 0, mid_x, height))
                
                # Parem pool (b)
                crop_b = img.crop((mid_x, 0, width, height))
                
                # Moodusta uued failinimed
                base_name, ext = os.path.splitext(filename)
                
                name_a = f"{base_name}a{ext}"
                name_b = f"{base_name}b{ext}"
                
                path_a = os.path.join(folder_path, name_a)
                path_b = os.path.join(folder_path, name_b)
                
                # Salvesta
                save_kwargs = {}
                if ext.lower() in ('.jpg', '.jpeg'):
                    save_kwargs = {'quality': 95, 'subsampling': 0}
                
                crop_a.save(path_a, **save_kwargs)
                crop_b.save(path_b, **save_kwargs)
                
                print(f"  Split @ {mid_x}px: {filename} -> {name_a}, {name_b}")
                count += 1
                
        except Exception as e:
            print(f"VIGA failiga {filename}: {e}")

    print(f"\nValmis! Poolitatud {count} faili.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Poolitab kaustas olevad pildid täpselt 50% pealt.")
    parser.add_argument("folder", help="Kausta teekond")
    
    args = parser.parse_args()
    
    # Kontrollime Pillow olemasolu
    try:
        import PIL
    except ImportError:
        print("VIGA: 'Pillow' teek puudub. Palun installi: pip install Pillow")
        sys.exit(1)
        
    split_images_in_folder(args.folder)
