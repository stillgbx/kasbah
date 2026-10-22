package org.kasbah.auto

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView

/** The phone side: the server address and the sign-in. Everything else happens on the car screen. */
class MainActivity : Activity() {
    private lateinit var client: KasbahClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        client = KasbahClient(this)
        val url = findViewById<EditText>(R.id.url)
        val user = findViewById<EditText>(R.id.user)
        val password = findViewById<EditText>(R.id.password)
        val login = findViewById<Button>(R.id.login)
        val error = findViewById<TextView>(R.id.error)
        // A password field switches to a monospace font by itself.
        password.typeface = Typeface.DEFAULT

        url.setText(client.baseUrl)
        user.setText(client.account)
        render()
        // Asked here, phone in hand, rather than on the road from the car screen.
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 0)
        }

        login.setOnClickListener {
            client.baseUrl = url.text.toString()
            login.isEnabled = false
            login.text = "Connexion…"
            error.visibility = View.GONE
            val name = user.text.toString().trim()
            Background.run({
                client.login(name, password.text.toString())
                client.accesses() // proves the address and the session
            }) { result ->
                login.isEnabled = true
                login.text = "Se connecter"
                password.text.clear()
                result.onSuccess { client.account = name; render() }.onFailure {
                    error.text = it.message ?: "Connexion impossible."
                    error.visibility = View.VISIBLE
                }
            }
        }
        findViewById<Button>(R.id.switch_account).setOnClickListener {
            Background.run({ client.logout() }) { render() }
        }
    }

    private fun render() {
        val signedIn = client.account.isNotEmpty()
        findViewById<View>(R.id.form).visibility = if (signedIn) View.GONE else View.VISIBLE
        findViewById<View>(R.id.connected).visibility = if (signedIn) View.VISIBLE else View.GONE
        findViewById<TextView>(R.id.account).text = "${client.account} · ${Uri.parse(client.baseUrl).host ?: client.baseUrl}"
    }
}
