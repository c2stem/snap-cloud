var projectIndex = $('#project-index');

function parseResponse(response) {
    var list = [];
    if (response) {
        response.split(' ').forEach(function (service) {
            var entries = service.split('&'),
                dict = {};
            entries.forEach(function (entry) {
                var pair = entry.split('='),
                    key = decodeURIComponent(pair[0]),
                    val = decodeURIComponent(pair[1]);
                dict[key] = val;
            });
            if (dict.Updated) {
                dict.Updated = new Date(dict.Updated);
            }
            list.push(dict);
        });
    }
    return list;
}

function loadProjects(page) {
    try {
        page = typeof page === 'number' ? +page : 0;
        var request = new XMLHttpRequest();
        request.open('GET', '/SnapCloud/PublicProjects?page=' + page, true);
        request.withCredentials = true;
        request.onreadystatechange = function () {
            if (request.readyState === 4) {
                if (request.status === 200) {
                    updateProjectList(parseResponse(request.responseText));
                } else {
                    reportError(request.statusText);
                }
            }
        };
        request.send(null);

    } catch (err) {
        reportError('Could not connect');
    }
}

function reportError(error) {
    var p = document.createElement('p');
    p.textContent = 'Error: ' + error;
    projectIndex.appendChild(p);
}

function updateProjectList(projects) {
    var cards = projects.map(project => {
        var url = project.Origin + '/snap.html#present:' +
            'Username=' + encodeURIComponent(project.User) +
            '&ProjectName=' + encodeURIComponent(project.ProjectName) +
            '&editMode&noRun';
        var metadata = 'created by ' + project.User;

        if (project.Updated) {
            metadata += ' at ' + project.Updated.getFullYear() + '/' +
                (project.Updated.getMonth() + 1) + '/' +
                project.Updated.getDate();
        }
        metadata += '\n' + project.Origin;

        return `
          <div class="col s12 m3 l2">
            <div class="card project-card">
              <div class="card-image waves-effect waves-block waves-light project-thumbnail" data-url="${url}">
                <img class="activator" src="${project.Thumbnail}" title="${metadata}">
              </div>
              <div class="card-content">
                  <span class="card-title project-title activator grey-text text-darken-4">${project.ProjectName}<i class="material-icons right">more_vert</i></span>
                <p><a href="${url}"></a></p>
              </div>
              <div class="card-reveal">
                  <span class="card-title project-title grey-text text-darken-4">${project.ProjectName}<i class="material-icons right">close</i></span>
                  <p>${project.Notes || '<i>no project notes</i>'}</p>
              </div>
            </div>
          </div>`;
    });

    // Add each of the cards to the columns
    projectIndex.append('<div class="row">' + cards.join('') + '</div>');

    // Click the card for opening the url
    $('.project-thumbnail').on('click', function(event) {
        var element = event.currentTarget,
            url = element.getAttribute('data-url');

        window.location = url;
    });
    /*
        var a = document.createElement('a');
        var title = ''
        if (project.Notes) {
            title += project.Notes + '\n';
        }
        a.title = title;
        a.href =

        var div = document.createElement('div');
        div.className = 'project';
        a.appendChild(div);

        var image = new Image();
        image.src = project.Thumbnail;
        div.appendChild(image);

        var title = document.createElement('p');
        title.textContent = project.ProjectName;
        div.appendChild(title);

        projectIndex.appendChild(a);
    });
    */
}

window.onload = function () {
    loadProjects(0);
}
