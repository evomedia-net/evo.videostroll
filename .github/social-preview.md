# Social preview

`social-preview.png` is the card GitHub shows when a link to this repository is
pasted into LinkedIn, Slack, a message or a post. Without one, the preview falls
back to the owner avatar and the repository name.

It is **1280x640**, which is the size GitHub asks for. That is deliberately not
the 1200x630 used elsewhere in this estate for `og:image`.

## It has to be uploaded by hand

GitHub exposes no API for the social preview image, so committing the file here
does not put it on the repository. Someone with admin access has to set it:

    Settings -> General -> Social preview -> Upload an image

Committing it anyway is the point of this directory: the file is versioned, it
travels with the repository, and the next person does not have to work out what
the card was made from.

## Regenerating it

The card is composed by `make_og_card.py` in the private tooling repo, from the
`videostroll` spec in that file:

    python make_og_card.py videostroll --out .github/social-preview.png

Re-run it when the wording changes, then upload the new file. Platforms cache a
preview image, so a card that changes needs the cache cleared at whichever
platform is holding the old one.
