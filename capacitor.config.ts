import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.easyflashcard.app',
    appName: 'EasyFlashcard',
    webDir: 'dist',
    server: {
        androidScheme: 'https',
    },
};

export default config;
