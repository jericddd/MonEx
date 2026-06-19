class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
    }

    preload() {
        // Force load from same folder
        this.load.image('chog', './chog.png');
    }

    create() {
        this.chog = this.add.image(400, 300, 'chog');
        
        if (!this.chog.texture.key) {
            this.add.text(400, 300, '❌ Cannot load chog.png\nMake sure file is in same folder', {
                fontSize: '20px', color: '#ff6666', align: 'center'
            }).setOrigin(0.5);
            return;
        }

        this.chog.setScale(1.4);

        this.add.text(400, 80, 'Chog - Breathing Animation', { 
            fontSize: '32px', color: '#fff' 
        }).setOrigin(0.5);

        // Breathing effect
        this.tweens.add({
            targets: this.chog,
            scaleX: 1.55,
            scaleY: 1.55,
            duration: 1300,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        this.add.text(400, 520, 'WASD / Arrow Keys to Move', { 
            fontSize: '18px', color: '#aaa', align: 'center' 
        }).setOrigin(0.5);
    }

    update() {
        const speed = 180;
        if (this.input.keyboard) {
            const cursors = this.input.keyboard.createCursorKeys();
            const keys = this.input.keyboard.addKeys('W,S,A,D');

            if (cursors.left.isDown || keys.A.isDown) this.chog.x -= speed * 0.016;
            if (cursors.right.isDown || keys.D.isDown) this.chog.x += speed * 0.016;
            if (cursors.up.isDown || keys.W.isDown) this.chog.y -= speed * 0.016;
            if (cursors.down.isDown || keys.S.isDown) this.chog.y += speed * 0.016;
        }
    }
}

const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    backgroundColor: '#1a1a2e',
    scene: GameScene
};

const game = new Phaser.Game(config);