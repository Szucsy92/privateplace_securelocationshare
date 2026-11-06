package hu.privateplace.app;

import androidx.core.content.FileProvider;

/**
 * Saját FileProvider az appon belüli frissítéshez. A Capacitor sablonja már bejegyez egy
 * androidx.core.content.FileProvider-t; két azonos osztálynevű provider nem fér meg egymás mellett
 * (a második kimarad), ezért a frissítés külön alosztályt használ.
 */
public class UpdateFileProvider extends FileProvider {}
